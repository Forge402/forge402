// Honest market failure, the optional CoinGecko key, and the RPC fallback list.
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { Store } from "../src/store.ts";
import { createRpcClient } from "../src/rpc.ts";
import { scanToken, type ScanDeps } from "../src/scan.ts";
import { runRadar } from "../src/radar.ts";
import { runWatchCron, type BotDeps } from "../src/watch.ts";
import { readMarket } from "../src/market.ts";

function fakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync("migrations").sort()) db.exec(readFileSync(`migrations/${f}`, "utf8"));
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as any[])).changes) } }),
    first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (list: any[]) => { for (const s of list) await s.run(); return []; } } as unknown as D1Database;
}

const NOW = 1_800_000_000_000;
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const TOKEN = "0x" + "a".repeat(40);
const code = readFileSync("test/fixtures/token-code.hex", "utf8").trim();
const gecko = JSON.parse(readFileSync("test/fixtures/gecko-token-pools.json", "utf8"));
const GECKO_TOKEN = "0x0339f5459FC690aC85F1782e15782A151b4A9E1b";

// RPC node that answers every batch like a token contract; markets answered by `market(url)`.
function world(market: (u: string) => Response, opts: { rpc?: string } = {}) {
  const log: { url: string; init?: RequestInit }[] = [];
  const rpcUrl = opts.rpc ?? "https://rpc.test";
  const fetch = async (u: string, init?: RequestInit) => {
    log.push({ url: u, init });
    if (u.startsWith("https://rpc.")) {
      const calls = JSON.parse(String(init?.body)) as { id: number; method: string; params: any[] }[];
      return res(calls.map((c) => ({ jsonrpc: "2.0", id: c.id, result: c.method === "eth_getCode" ? code : c.method === "eth_getStorageAt" ? "0x" + "0".repeat(64) : "0x" })));
    }
    return market(u);
  };
  const ai = { prompts: [] as string[], run: async (_m: string, input: any) => { ai.prompts.push(JSON.stringify(input)); return { response: "x" }; } };
  const deps = (): ScanDeps => ({ rpc: createRpcClient({ url: rpcUrl, fetch, sleep: async () => {} }), fetch, sleep: async () => {}, now: () => NOW, tickerOthers: async () => 0, ai });
  return { log, fetch, deps, ai };
}

const rateLimited = () => res("error code: 1015", 429);
const noPool = (u: string) => (u.includes("dexscreener") ? res([]) : res({ data: [] }));

describe("market_status", () => {
  it("unavailable: checks unknown, no penalty, summary prompt never says no pool", async () => {
    const w = world(rateLimited);
    const d = await scanToken(TOKEN, w.deps());
    expect(d.result.market_status).toBe("unavailable");
    expect(d.result.market).toBeNull();
    for (const id of ["liquidity", "flow_24h", "pool_age"]) {
      const c = d.result.checks.find((x) => x.id === id)!;
      expect(c.status).toBe("unknown");
      expect(c.detail).toContain("Market data unavailable right now");
    }
    expect(d.fired).not.toContain("no_pool");
    const reachable = await scanToken(TOKEN, world((u) => (u.includes("dexscreener") ? res([]) : res({ data: [] }))).deps());
    expect(d.result.score).toBe(reachable.result.score + 25); // no_pool would have cost 25
    expect(w.ai.prompts.join("\n")).not.toMatch(/no pool/i);
  });

  it("no_pool path is unchanged: flag, -25", async () => {
    const d = await scanToken(TOKEN, world(noPool).deps());
    expect(d.result.market_status).toBe("no_pool");
    expect(d.result.checks.find((x) => x.id === "liquidity")).toMatchObject({ status: "flag", detail: "No pool found for this token on Robinhood Chain." });
    expect(d.fired).toContain("no_pool");
  });

  it("ok when a pool is found", async () => {
    const d = await scanToken(GECKO_TOKEN, world((u) => (u.includes("dexscreener") ? res([]) : res(gecko))).deps());
    expect(d.result.market_status).toBe("ok");
  });

  it("radar skips cleanly when discovery is unavailable", async () => {
    const w = world(rateLimited);
    const store = new Store(fakeD1());
    const d = w.deps();
    const r = await runRadar(store, d, d);
    expect(r).toEqual({ scanned: 0, rechecked: 0, candidates: 0, skipped: "discovery_unavailable" });
  });

  it("watch: an unreachable market raises no liquidity alert and keeps the last liquidity", async () => {
    const w = world(rateLimited);
    const store = new Store(fakeD1());
    await store.watchUpsert("c1", TOKEN, "T", { owner: null, impl: null, liquidity_usd: 10_000, score: 90, supply: null }, NOW - 1000);
    const sent: string[] = [];
    const bot: BotDeps = { store, scan: w.deps(), fetch: (async (u: string) => { sent.push(u); return res({ ok: true }); }) as typeof fetch, botToken: "t", now: () => NOW };
    const r = await runWatchCron(bot);
    expect(r.alerts).toBe(0);
    expect(sent.some((u) => u.includes("telegram"))).toBe(false);
    expect((await store.watchOldestChecked(5))[0].state.liquidity_usd).toBe(10_000);
  });
});

describe("CoinGecko key path", () => {
  const deps = (f: (u: string) => Response, key?: string) => ({ fetch: async (u: string, init?: RequestInit) => { seen.push({ u, h: (init?.headers ?? {}) as Record<string, string> }); return f(u); }, sleep: async () => {}, now: () => NOW, coingeckoKey: key });
  let seen: { u: string; h: Record<string, string> }[] = [];
  it("keyed: CoinGecko URL + header first, no DexScreener call when it answers", async () => {
    seen = [];
    const r = await readMarket(GECKO_TOKEN, deps(() => res(gecko), "KEY"));
    expect(r.market?.source).toBe("geckoterminal");
    expect(seen).toHaveLength(1);
    expect(seen[0].u).toBe(`https://api.coingecko.com/api/v3/onchain/networks/robinhood/tokens/${GECKO_TOKEN}/pools`);
    expect(seen[0].h["x-cg-demo-api-key"]).toBe("KEY");
  });
  it("keyed: 429 from CoinGecko falls back to DexScreener", async () => {
    seen = [];
    const dex = JSON.parse(readFileSync("test/fixtures/dexscreener-token-pairs.json", "utf8"));
    const r = await readMarket(GECKO_TOKEN, deps((u) => (u.includes("coingecko") ? rateLimited() : res(dex)), "KEY"));
    expect(r.market?.source).toBe("dexscreener");
    expect(seen[0].u).toContain("api.coingecko.com");
    expect(seen[1].u).toContain("api.dexscreener.com");
  });
  it("unkeyed: unchanged order, no key header", async () => {
    seen = [];
    await readMarket(GECKO_TOKEN, deps((u) => (u.includes("dexscreener") ? res([]) : res(gecko))));
    expect(seen[0].u).toContain("api.dexscreener.com");
    expect(seen.at(-1)!.u).toContain("api.geckoterminal.com");
    expect(seen.every((s) => !("x-cg-demo-api-key" in s.h))).toBe(true);
  });
});

describe("RPC fallback list", () => {
  const one = [{ method: "eth_chainId", params: [] }];
  const client = (urls: string[], f: (u: string) => Response, hits: string[]) =>
    createRpcClient({ url: urls, fetch: async (u) => { hits.push(u); return f(u); }, sleep: async () => {} });
  const ok = () => res([{ jsonrpc: "2.0", id: 1, result: "0x1" }]);

  it("falls over to the next URL on 429", async () => {
    const hits: string[] = [];
    const r = await client(["https://a.test", "https://b.test"], (u) => (u.includes("a.test") ? res({}, 429) : ok()), hits).batch(one);
    expect(r[0]).toEqual({ ok: true, value: "0x1" });
    expect(hits).toEqual(["https://a.test", "https://b.test"]);
  });
  it("never makes more than 2 attempts per batch, even with 3 URLs all failing", async () => {
    const hits: string[] = [];
    await expect(client(["https://a.test", "https://b.test", "https://c.test"], () => res({}, 503), hits).batch(one)).rejects.toThrow();
    expect(hits).toHaveLength(2);
  });
  it("a single URL keeps its 2 tries", async () => {
    const hits: string[] = [];
    await expect(client(["https://a.test"], () => res({}, 503), hits).batch(one)).rejects.toThrow();
    expect(hits).toHaveLength(2);
  });
  it("does not fail over on a non-retryable answer, and errors never contain the URL", async () => {
    const hits: string[] = [];
    const e = await client(["https://a.test/KEY123", "https://b.test"], () => res({}, 400), hits).batch(one).catch((x) => x);
    expect(hits).toHaveLength(1);
    expect(String(e)).not.toContain("KEY123");
  });
});
