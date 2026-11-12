// Forge402 scan worker: Forge Scan, Launch Radar, Forge Watch. Routes follow forge402/API.md "scan worker routes".
import { ApiError, errorBody } from "./errors.ts";
import { createRpcClient } from "./rpc.ts";
import { ADDRESS, scanToken, type ScanDeps } from "./scan.ts";
import { rulesDocument } from "./rules.ts";
import { runRadar } from "./radar.ts";
import type { AiBudget } from "./summary.ts";
import { Store, type CgCaller } from "./store.ts";
import { handleMessage, runWatchCron, type BotDeps } from "./watch.ts";
import { checkPayload, createFacilitator, DEFAULT_FACILITATOR, FacilitatorUnavailable, fromBase64, paymentNonce, paymentRequired, requirementsFor, toBase64, scanPriceAtomic } from "./x402.ts";

export type Env = {
  DB: D1Database;
  AI?: Ai;
  SCAN_AI_DAILY_NEURONS?: string; // Workers AI neurons per UTC day this worker may spend; "0" = no cap; default 1000
  RPC_URL?: string; // secret: the owner's Chainstack node; may be a comma-separated list, tried in order, public node last
  COINGECKO_DAILY_CALLS?: string; // CoinGecko calls per UTC day this worker may make (Demo plan: ~10,000 per month); "0" = no cap; default 300
  COINGECKO_API_KEY?: string; // secret, optional: GeckoTerminal data via CoinGecko's keyed API (works from Workers)
  PAY_TO?: string;
  SCAN_PRICE_USD?: string; // paid scan price in USD, default "0.02"; must be at least SETTLE_FEE_USD + 0.002 or paid scans answer 503
  SETTLE_FEE_USD?: string; // what the facilitator charges the merchant per settled payment, default "0.015"
  FACILITATOR_URL?: string;
  FACILITATOR_API_KEY?: string; // secret, optional
  ALLOWED_ORIGINS?: string;
  TELEGRAM_BOT_TOKEN?: string; // secret
  TELEGRAM_WEBHOOK_SECRET?: string; // secret
};

const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com"; // eth_call / getCode / getStorageAt only; it refuses getLogs from Cloudflare
const FREE_PER_HOUR = 30;
const REUSE_MS = 120_000; // a free scan of an address scanned in the last 2 minutes returns the stored answer

const cfFetch = (input: string, init?: RequestInit) => fetch(input, init);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function aiBudget(env: Env, store: Store): AiBudget {
  const n = Number(env.SCAN_AI_DAILY_NEURONS ?? "1000");
  const day = () => new Date().toISOString().slice(0, 10);
  return { cap: Number.isFinite(n) && n >= 0 ? n : 1000, used: () => store.aiUsed(day()), add: async (x) => { await store.aiAdd(day(), x); } };
}

function scanDeps(env: Env, store: Store, caller: CgCaller = "scan"): ScanDeps {
  const n = Number(env.COINGECKO_DAILY_CALLS ?? "300");
  return {
    rpc: createRpcClient({ url: [...(env.RPC_URL ?? "").split(",").map((u) => u.trim()).filter(Boolean), PUBLIC_RPC], fetch: cfFetch, sleep }),
    fetch: cfFetch, sleep, now: Date.now, coingeckoKey: env.COINGECKO_API_KEY || undefined,
    cgGate: store.cgGate(caller, Number.isFinite(n) && n >= 0 ? n : 300, Date.now),
    tickerOthers: (norm, address) => store.tickerOthers(norm, address, Date.now()),
    ai: env.AI,
    aiBudget: aiBudget(env, store),
  };
}

// Sent on every response. HSTS keeps browsers on https after the first visit; nosniff stops JSON being run as script.
const SECURITY_HEADERS: Record<string, string> = { "strict-transport-security": "max-age=31536000; includeSubDomains", "x-content-type-options": "nosniff" };

// Plain http is refused, not redirected: by the time a redirect is sent the key or session has already crossed in the
// clear. Local dev (localhost) is exempt.
const plainHttp = (url: URL) => url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1";

// IPv4: the address. IPv6: its /64, since one home gets a whole /64 and could otherwise mint a fresh free tier per
// request. Same rule as the router's playground (api/src/playground.ts callerKey).
export function callerKey(req: Request): string {
  const raw = (req.headers.get("cf-connecting-ip") ?? "").trim().toLowerCase();
  if (!raw.includes(":")) return raw || "unknown";
  let groups = raw.split(":");
  if (raw.includes("::")) {
    const [head, tail] = raw.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    groups = [...left, ...Array(Math.max(8 - left.length - right.length, 0)).fill("0"), ...right];
  }
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

function cors(env: Env, req: Request): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin");
  const h: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, PAYMENT-SIGNATURE",
    "access-control-expose-headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-RateLimit-Remaining, Retry-After",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
  if (allowed.includes("*")) h["access-control-allow-origin"] = "*";
  else if (origin && allowed.includes(origin)) h["access-control-allow-origin"] = origin;
  return h;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

const sha256Hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function parseAddress(raw: unknown): string {
  if (typeof raw !== "string" || !ADDRESS.test(raw.trim())) throw new ApiError(400, "bad_request", "address must be 0x followed by 40 hex characters");
  return raw.trim().toLowerCase();
}

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const store = new Store(env.DB);

  if (path === "/" && req.method === "GET") return json(200, { service: "forge402-scan", routes: ["GET /v1/scan/:address", "POST /v1/scan", "GET /v1/scan/rules", "GET /v1/scan/recent", "GET /v1/scan/count", "GET /v1/radar", "POST /tg/webhook"] });

  if (path === "/v1/scan/rules" && req.method === "GET") return json(200, rulesDocument(), { "cache-control": "public, max-age=300" });
  // Every scan saved (web, paid, radar, telegram) since ?since= (unix ms). The router's /v1/stats reads it.
  if (path === "/v1/scan/count" && req.method === "GET") {
    const since = Number(url.searchParams.get("since") ?? 0);
    return json(200, { count: await store.countScans(Number.isFinite(since) && since > 0 ? since : 0) }, { "cache-control": "public, max-age=30" });
  }
  if (path === "/v1/scan/recent" && req.method === "GET") return json(200, { scans: (await store.recentScans(12)).map((r) => ({ address: r.address, symbol: r.symbol, name: r.name, score: r.score, verdict: r.verdict, scanned_at: r.scanned_at })) });

  if (path === "/v1/radar" && req.method === "GET") {
    const { tot, since, latest } = await store.radarSummary();
    return json(200, {
      since: since === null ? null : new Date(since).toISOString(),
      scanned: tot?.scanned ?? 0,
      rechecked: tot?.rechecked ?? 0,
      outcomes: { held: tot?.held ?? 0, up: tot?.up ?? 0, down: tot?.down ?? 0, drained: tot?.drained ?? 0 },
      latest: latest.map((r) => ({ address: r.address, symbol: r.symbol, name: r.name, score: r.score, verdict: r.verdict, flags: JSON.parse(r.flags_json) as string[], liquidity_usd: r.liquidity_first, pool_age_hours: r.pool_age_hours, first_seen: new Date(r.first_seen_ms).toISOString(), outcome: r.outcome ?? "pending", liquidity_24h_usd: r.liquidity_now })),
    });
  }

  const free = path.match(/^\/v1\/scan\/(0x[0-9a-fA-F]+)$/);
  if (free && req.method === "GET") {
    const address = parseAddress(free[1]);
    const ip = callerKey(req);
    const used = await store.hit("ip:" + (await sha256Hex(ip)).slice(0, 24), Date.now());
    const rl = { "x-ratelimit-remaining": String(Math.max(0, FREE_PER_HOUR - used)) };
    if (used > FREE_PER_HOUR) throw new ApiError(429, "rate_limited", `The free scan allows ${FREE_PER_HOUR} per hour per address of yours. Try again later or use POST /v1/scan (x402).`, { "retry-after": "3600" });
    const cached = await store.freshScan(address, Date.now() - REUSE_MS);
    if (cached) return json(200, cached, rl);
    const detail = await scanOrFail(address, scanDeps(env, store));
    ctx.waitUntil(store.saveScan(detail.result, detail.tickerNorm, "web", Date.now()).catch(() => {}));
    return json(200, detail.result, rl);
  }

  if (path === "/v1/scan" && req.method === "POST") return paidScan(req, env, ctx, store);

  if (path === "/tg/webhook" && req.method === "POST") {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) throw new ApiError(503, "not_configured", "The Telegram bot is not set up on this server.");
    if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token") ?? "", env.TELEGRAM_WEBHOOK_SECRET)) throw new ApiError(401, "invalid_key", "Wrong or missing webhook secret.");
    const update: any = await req.json().catch(() => null);
    const msg = update?.message;
    if (msg?.chat?.id !== undefined && typeof msg.text === "string") {
      const chatId = String(msg.chat.id);
      const bot = botDeps(env, store);
      ctx.waitUntil((async () => {
        const reply = await handleMessage(chatId, msg.text, bot).catch((e) => { console.log(JSON.stringify({ event: "tg_error", error: String(e) })); return "Something went wrong. Try again in a minute."; });
        if (reply) await (await import("./telegram.ts")).sendMessage(cfFetch as typeof fetch, bot.botToken, chatId, reply);
      })());
    }
    return json(200, { ok: true });
  }

  throw new ApiError(404, "bad_request", "No such route.");
}

async function scanOrFail(address: string, deps: ScanDeps) {
  try {
    return await scanToken(address, deps);
  } catch (e) {
    console.log(JSON.stringify({ event: "scan_failed", address, error: String(e) }));
    throw new ApiError(502, "upstream_error", "Could not read this token from the chain right now. Try again shortly.");
  }
}

async function paidScan(req: Request, env: Env, ctx: ExecutionContext, store: Store): Promise<Response> {
  if (!env.PAY_TO || !/^0x[0-9a-fA-F]{40}$/.test(env.PAY_TO) || !env.FACILITATOR_URL) throw new ApiError(503, "not_configured", "Paid scans are not set up on this server yet (no payout address).");
  const price = scanPriceAtomic(env.SCAN_PRICE_USD, env.SETTLE_FEE_USD);
  if (!price) throw new ApiError(503, "not_configured", "Paid scans are paused: the configured price does not cover the payment fee.");
  const ours = requirementsFor(env.PAY_TO, price);
  const resource = new URL(req.url).toString();
  const desc = `Forge Scan: one token risk read on Robinhood Chain ($${Number(price) / 1e6})`;
  const quote = (error: string, code: string, status = 402) => {
    const body = { ...paymentRequired(resource, ours, desc), ...errorBody(code, error) }; // same JSON in body and PAYMENT-REQUIRED header
    return json(status, body, { "payment-required": toBase64(body) });
  };

  const header = req.headers.get("payment-signature");
  if (!header) return quote("Payment required.", "payment_required");
  const payload = fromBase64(header);
  const problem = checkPayload(payload, ours);
  if (problem) return quote(problem, "terms_mismatch");

  const body: any = await req.json().catch(() => null);
  const address = parseAddress(body?.address);

  const nonce = paymentNonce(payload);
  if (!nonce) return quote("payment payload carries no authorization nonce", "verify_invalid");
  if (!(await store.takeNonce(nonce, Date.now()))) throw new ApiError(409, "payment_replayed", "This payment authorization was already used.");

  const fac = createFacilitator({ url: env.FACILITATOR_URL, apiKey: env.FACILITATOR_API_KEY, fetch: cfFetch as typeof fetch });
  try {
    const v = await fac.verify(payload, ours);
    if (!v.isValid) { await store.releaseNonce(nonce); return quote(`payment not valid: ${v.invalidReason ?? "unknown reason"}`, "verify_invalid"); }
    let detail;
    try {
      detail = await scanOrFail(address, scanDeps(env, store));
    } catch (e) { await store.releaseNonce(nonce); throw e; } // failed work is never settled
    let s = await fac.settle(payload, ours);
    // "settlement_pending" means the transfer is out but unconfirmed: ask again with the same payload a few times.
    for (const wait of [1000, 2000, 2000]) {
      if (s.success || s.errorReason !== "settlement_pending") break;
      await sleep(wait);
      s = await fac.settle(payload, ours);
    }
    if (!s.success && s.errorReason === "settlement_pending") {
      // It may still land, so the nonce stays taken (the signature is spent either way). Logged for the owner to
      // check on chain and refund by hand if it confirmed.
      console.error("scan settlement_pending", JSON.stringify({ nonce, payer: (payload as any)?.payload?.authorization?.from, amount: ours.amount }));
      throw new ApiError(409, "settlement_pending", "The payment is still unconfirmed on chain, so no result was released. Do not resend this signature. If it confirms, it is refunded to your wallet.");
    }
    if (!s.success) { await store.releaseNonce(nonce); throw new ApiError(502, "upstream_error", "The payment could not be settled, so no result was released and nothing was charged."); }
    ctx.waitUntil(store.saveScan(detail.result, detail.tickerNorm, "paid", Date.now()).catch(() => {}));
    return json(200, detail.result, { "payment-response": toBase64(s) });
  } catch (e) {
    if (e instanceof FacilitatorUnavailable) { await store.releaseNonce(nonce); throw new ApiError(502, "upstream_error", "The payment facilitator is unreachable. Nothing was charged."); }
    throw e;
  }
}

function botDeps(env: Env, store: Store, caller: CgCaller = "scan"): BotDeps {
  return { store, scan: scanDeps(env, store, caller), fetch: cfFetch as typeof fetch, botToken: env.TELEGRAM_BOT_TOKEN!, now: Date.now };
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const c = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c });
    let res: Response;
    try {
      if (plainHttp(new URL(req.url))) throw new ApiError(400, "https_required", "Use https://. Plain http is refused.");
      res = await route(req, env, ctx);
    } catch (e) {
      if (e instanceof ApiError) res = json(e.status, errorBody(e.code, e.message), e.headers);
      else { console.log(JSON.stringify({ event: "unhandled", error: String(e) })); res = json(500, errorBody("upstream_error", "Something broke on our side.")); }
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...c })) out.headers.set(k, v);
    return out;
  },

  // "0 * * * *" = Launch Radar plus housekeeping. "*/5 * * * *" = Forge Watch.
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    const store = new Store(env.DB);
    if (event.cron === "*/5 * * * *") {
      if (!env.TELEGRAM_BOT_TOKEN) return;
      console.log(JSON.stringify({ event: "watch_run", ...(await runWatchCron(botDeps(env, store, "watch"))) }));
      return;
    }
    const deps = scanDeps(env, store, "radar");
    console.log(JSON.stringify({ event: "radar_run", ...(await runRadar(store, deps, deps)) }));
    await store.prune(Date.now()).catch(() => {});
  },
};
