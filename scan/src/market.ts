// Pool data. DexScreener first (keyless, works from Cloudflare), GeckoTerminal as fallback (it often answers 429 to
// Cloudflare's shared addresses). Both parsers trust nothing: a pair with an odd shape is skipped.
import { requestJson, HttpError, type Fetcher, type Sleep } from "./http-json.ts";
import type { Market } from "./types.ts";

export const DEXSCREENER = "https://api.dexscreener.com";
export const GECKO = "https://api.geckoterminal.com/api/v2/networks/robinhood";
// With a CoinGecko demo key the same JSON:API paths are served here, limited per key instead of per IP.
// UNVERIFIED: that the onchain network id is "robinhood" on CoinGecko (not checked against a live keyed request).
export const COINGECKO = "https://api.coingecko.com/api/v3/onchain/networks/robinhood";
export const DEX_CHAIN_ID = "robinhood"; // checked with a real request on 2026-11-12

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const cnt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

type Pool = { pool: string; dex: string; liq: number | null; buys: number; sells: number; hasTxns: boolean; price: number | null; fdv: number | null; createdMs: number | null; symbol: string | null; name: string | null; volume24: number | null };

// One token, many pools: the deepest pool is "the pool"; liquidity and flow add up over all pools; age is the oldest pool.
function combine(pools: Pool[], source: Market["source"], nowMs: number): Market | null {
  if (!pools.length) return null;
  const deepest = pools.reduce((a, b) => ((b.liq ?? -1) > (a.liq ?? -1) ? b : a));
  const known = pools.map((p) => p.liq).filter((x): x is number => x !== null);
  const withTx = pools.filter((p) => p.hasTxns);
  const created = pools.map((p) => p.createdMs).filter((x): x is number => x !== null);
  return {
    liquidity_usd: known.length ? Math.round(known.reduce((a, b) => a + b, 0) * 100) / 100 : null,
    dex: deepest.dex,
    pool: deepest.pool,
    txns_24h: withTx.length ? { buys: withTx.reduce((a, p) => a + p.buys, 0), sells: withTx.reduce((a, p) => a + p.sells, 0) } : null,
    price_usd: deepest.price,
    fdv_usd: deepest.fdv,
    pool_age_hours: created.length ? Math.max(0, Math.round(((nowMs - Math.min(...created)) / 3_600_000) * 10) / 10) : null,
    source,
    symbol: deepest.symbol,
    name: deepest.name,
  };
}

// DexScreener: GET /token-pairs/v1/robinhood/{address} -> [pair]. Also fed by /tokens/v1/robinhood/{a,b,c}.
export function parseDexPairs(json: unknown, token: string, nowMs: number): Market | null {
  if (!Array.isArray(json)) return null;
  const t = token.toLowerCase();
  const pools: Pool[] = [];
  for (const p of json) {
    if (!isObj(p) || p.chainId !== DEX_CHAIN_ID || !isObj(p.baseToken) || typeof p.pairAddress !== "string") continue;
    if (String(p.baseToken.address).toLowerCase() !== t) continue;
    const h24 = isObj(p.txns) && isObj(p.txns.h24) ? p.txns.h24 : null;
    pools.push({
      pool: p.pairAddress.toLowerCase(),
      dex: typeof p.dexId === "string" ? p.dexId.slice(0, 32) : "unknown",
      liq: isObj(p.liquidity) ? num(p.liquidity.usd) : null,
      buys: cnt(h24?.buys), sells: cnt(h24?.sells), hasTxns: h24 !== null,
      price: num(p.priceUsd), fdv: num(p.fdv),
      createdMs: typeof p.pairCreatedAt === "number" && p.pairCreatedAt > 0 ? p.pairCreatedAt : null,
      symbol: typeof p.baseToken.symbol === "string" ? p.baseToken.symbol.slice(0, 64) : null,
      name: typeof p.baseToken.name === "string" ? p.baseToken.name.slice(0, 64) : null,
      volume24: isObj(p.volume) ? num(p.volume.h24) : null,
    });
  }
  return combine(pools, "dexscreener", nowMs);
}

// GeckoTerminal: GET /networks/robinhood/tokens/{address}/pools -> JSON:API { data:[{ attributes, relationships }] }.
export function parseGeckoPools(json: unknown, token: string, nowMs: number): Market | null {
  if (!isObj(json) || !Array.isArray(json.data)) return null;
  const t = token.toLowerCase();
  const pools: Pool[] = [];
  for (const item of json.data) {
    const a = isObj(item) && isObj(item.attributes) ? item.attributes : null;
    const rel = isObj(item) && isObj(item.relationships) ? item.relationships : null;
    if (!a || !rel || typeof a.address !== "string") continue;
    const baseId = isObj(rel.base_token) && isObj(rel.base_token.data) && typeof rel.base_token.data.id === "string" ? rel.base_token.data.id : "";
    if (baseId.slice(baseId.indexOf("_") + 1).toLowerCase() !== t) continue;
    const h24 = isObj(a.transactions) && isObj(a.transactions.h24) ? a.transactions.h24 : null;
    const created = typeof a.pool_created_at === "string" ? Date.parse(a.pool_created_at) : NaN;
    const nameParts = typeof a.name === "string" ? a.name.split(" / ") : [];
    pools.push({
      pool: a.address.toLowerCase(),
      dex: isObj(rel.dex) && isObj(rel.dex.data) && typeof rel.dex.data.id === "string" ? rel.dex.data.id.slice(0, 32) : "unknown",
      liq: num(a.reserve_in_usd),
      buys: cnt(h24?.buys), sells: cnt(h24?.sells), hasTxns: h24 !== null,
      price: num(a.base_token_price_usd), fdv: num(a.fdv_usd),
      createdMs: Number.isFinite(created) ? created : null,
      symbol: nameParts[0]?.trim().slice(0, 64) || null,
      name: null,
      volume24: isObj(a.volume_usd) ? num(a.volume_usd.h24) : null,
    });
  }
  return combine(pools, "geckoterminal", nowMs);
}

export type MarketDeps = { fetch: Fetcher; sleep: Sleep; now: () => number; coingeckoKey?: string; cgGate?: () => Promise<boolean> }; // cgGate: counts a CoinGecko call, false = budget spent, skip it
export type MarketRead = { market: Market | null; unavailable: boolean };

const geckoBase = (d: MarketDeps) => (d.coingeckoKey ? COINGECKO : GECKO);
const geckoInit = (d: MarketDeps): RequestInit => ({ method: "GET", ...(d.coingeckoKey ? { headers: { "x-cg-demo-api-key": d.coingeckoKey } } : {}) });

// A source "answered" when it returned JSON or a plain 404 (unknown token). 429, 5xx, timeouts, challenges: it did not.
async function ask(url: string, init: RequestInit, d: MarketDeps, tries: number): Promise<{ ok: true; json: unknown } | { ok: false }> {
  try {
    return { ok: true, json: await requestJson(url, init, { fetch: d.fetch, sleep: d.sleep, tries, timeoutMs: 8000 }) };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { ok: true, json: null };
    return { ok: false };
  }
}

// Key set: CoinGecko first, DexScreener as fallback. No key: DexScreener first, GeckoTerminal as fallback.
// unavailable = no source answered. A source that answered "nothing here" makes it no_pool, not unavailable.
export async function readMarket(token: string, d: MarketDeps): Promise<MarketRead> {
  const dex = async () => { const r = await ask(`${DEXSCREENER}/token-pairs/v1/${DEX_CHAIN_ID}/${token}`, { method: "GET" }, d, 2); return r.ok ? { ok: true as const, m: parseDexPairs(r.json, token, d.now()) } : r; };
  const gecko = async () => { if (d.coingeckoKey && d.cgGate && !(await d.cgGate())) return { ok: false as const }; const r = await ask(`${geckoBase(d)}/tokens/${token}/pools`, geckoInit(d), d, 1); return r.ok ? { ok: true as const, m: parseGeckoPools(r.json, token, d.now()) } : r; };
  let answered = false;
  for (const read of d.coingeckoKey ? [gecko, dex] : [dex, gecko]) {
    const r = await read();
    if (r.ok) { answered = true; if (r.m) return { market: r.m, unavailable: false }; }
  }
  return { market: null, unavailable: !answered };
}

// Radar discovery: tokens seen on DexScreener's profile and boost feeds plus search results for this chain, then one
// batched read for their pairs. Returns every pair we can read; the caller filters by age and liquidity.
export type Candidate = { token: string; symbol: string | null; market: Market; volume24: number };

// Returns null when the sources could not be reached (rate-limited), so the caller can skip instead of recording zero pools.
export async function discoverYoungPools(d: MarketDeps, opts: { maxAgeH: number; minLiq: number }): Promise<Candidate[] | null> {
  let dexAnswered = false;
  const get = (path: string) => requestJson(DEXSCREENER + path, { method: "GET" }, { fetch: d.fetch, sleep: d.sleep, tries: 2, timeoutMs: 8000 }).then((j) => { dexAnswered = true; return j; }, () => null);
  const [profiles, boosts, s1, s2] = await Promise.all([
    get("/token-profiles/latest/v1"), get("/token-boosts/latest/v1"),
    get("/latest/dex/search?q=WETH%20robinhood"), get("/latest/dex/search?q=USDG%20robinhood"),
  ]);
  const addrs = new Set<string>();
  for (const feed of [profiles, boosts]) if (Array.isArray(feed)) for (const x of feed) if (isObj(x) && x.chainId === DEX_CHAIN_ID && /^0x[0-9a-fA-F]{40}$/.test(x.tokenAddress)) addrs.add(x.tokenAddress.toLowerCase());
  for (const s of [s1, s2]) if (isObj(s) && Array.isArray(s.pairs)) for (const p of s.pairs) if (isObj(p) && p.chainId === DEX_CHAIN_ID && isObj(p.baseToken) && /^0x[0-9a-fA-F]{40}$/.test(p.baseToken.address)) addrs.add(p.baseToken.address.toLowerCase());
  // GeckoTerminal's newest pools, best effort (often 429 from Cloudflare).
  const geckoAllowed = !(d.coingeckoKey && d.cgGate) || (await d.cgGate());
  const gecko = geckoAllowed ? await requestJson(`${geckoBase(d)}/new_pools`, geckoInit(d), { fetch: d.fetch, sleep: d.sleep, tries: 1, timeoutMs: 8000 }).catch(() => null) : null;
  const geckoAnswered = gecko !== null;
  if (!dexAnswered && !geckoAnswered) return null;
  if (isObj(gecko) && Array.isArray(gecko.data)) for (const it of gecko.data) {
    const id = it?.relationships?.base_token?.data?.id;
    if (typeof id === "string") { const a = id.slice(id.indexOf("_") + 1).toLowerCase(); if (/^0x[0-9a-f]{40}$/.test(a)) addrs.add(a); }
  }
  const list = [...addrs].slice(0, 30);
  if (!list.length) return [];
  const pairs = await get(`/tokens/v1/${DEX_CHAIN_ID}/${list.join(",")}`);
  if (pairs === null) return null; // found addresses but could not read their pairs: unavailable, not "no young pools"
  const out: Candidate[] = [];
  const now = d.now();
  for (const a of list) {
    const m = parseDexPairs(pairs, a, now);
    if (!m || m.pool_age_hours === null || m.pool_age_hours > opts.maxAgeH || (m.liquidity_usd ?? 0) < opts.minLiq) continue;
    const vol = Array.isArray(pairs) ? pairs.reduce((s: number, p: any) => s + (String(p?.baseToken?.address).toLowerCase() === a ? num(p?.volume?.h24) ?? 0 : 0), 0) : 0;
    out.push({ token: a, symbol: m.symbol, market: m, volume24: vol });
  }
  return out.sort((x, y) => y.volume24 - x.volume24);
}

// One request for up to 30 tokens: Map(token -> Market | null), or null when the request itself failed.
// A token with no pool maps to null; a failed request is never mistaken for "no pool".
export async function readMarketsBatch(tokens: string[], d: MarketDeps): Promise<Map<string, Market | null> | null> {
  const list = tokens.slice(0, 30);
  if (!list.length) return new Map();
  try {
    const json = await requestJson(`${DEXSCREENER}/tokens/v1/${DEX_CHAIN_ID}/${list.join(",")}`, { method: "GET" }, { fetch: d.fetch, sleep: d.sleep, tries: 2, timeoutMs: 8000 });
    if (!Array.isArray(json)) return null;
    const now = d.now();
    return new Map(list.map((t) => [t.toLowerCase(), parseDexPairs(json, t, now)]));
  } catch {
    return null;
  }
}
