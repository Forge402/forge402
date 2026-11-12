// Cloudflare Worker entry for the Forge402 router API. Routing, CORS, error shape and config checks only;
// the rules live in service.ts, accounts.ts, billing.ts and pay.ts. See README.md for bindings and secrets.
import * as acc from "./accounts.ts";
import { keyPayer, x402Payer } from "./billing.ts";
import { llmsTxt, openapi, wellKnownX402 } from "./discovery.ts";
import type { Ctx, Env } from "./env.ts";
import { ApiError, notConfigured } from "./errors.ts";
import { handleMcp } from "./mcp.ts";
import { modelList } from "./models.ts";
import { parseChat, parseEmbeddings } from "./openai.ts";
import { jsonRes, type PayDeps } from "./pay.ts";
import { callerKey, playgroundChat } from "./playground.ts";
import { sha256Hex } from "./keys.ts";
import { ceilingMicro } from "./pricing.ts";
import { createRepo } from "./repo.ts";
import { runChat, runEmbeddings, type ServiceDeps } from "./service.ts";
import { RANGES, statsFor } from "./stats.ts";

const MAX_BODY_BYTES = 1_000_000;
const EXPOSE = "X-Forge-Cost-Usd, X-Forge-Cache, X-Forge-Discount-Pct, X-Forge-Model, PAYMENT-REQUIRED, PAYMENT-RESPONSE";
const ALLOW_HEADERS = "Authorization, Content-Type, PAYMENT-SIGNATURE, X-Forge-Cache";

// Sent on every response. HSTS keeps browsers on https after the first visit; nosniff stops JSON being run as script.
const SECURITY_HEADERS: Record<string, string> = { "strict-transport-security": "max-age=31536000; includeSubDomains", "x-content-type-options": "nosniff" };

// Plain http is refused, not redirected: by the time a redirect is sent the key or session has already crossed in the
// clear. Local dev (localhost) is exempt.
const plainHttp = (url: URL) => url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1";

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes("*") ? "*" : origin && allowed.includes(origin) ? origin : null;
  if (!ok) return {};
  return {
    "access-control-allow-origin": ok,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": ALLOW_HEADERS,
    "access-control-expose-headers": EXPOSE,
    "access-control-max-age": "86400",
    ...(ok === "*" ? {} : { vary: "Origin" }),
  };
}

const errorRes = (e: unknown): Response => {
  if (e instanceof ApiError) return jsonRes(e.status, { error: { code: e.code, message: e.message } });
  console.error("unhandled", e instanceof Error ? e.message : "unknown"); // no detail goes to the caller
  return jsonRes(500, { error: { code: "internal_error", message: "Something went wrong on our side." } });
};

async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new ApiError(400, "bad_request", "The request body is too large.");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError(400, "bad_request", "The request body is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "bad_request", "The body is not valid JSON.");
  }
}

// `fetchImpl` talks to the facilitator and the chain RPC; tests hand in a fake.
export function makeWorker(fetchImpl: typeof fetch = (i, init) => fetch(i, init), sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), now: () => number = Date.now) {
  async function route(req: Request, env: Env, ctx?: Ctx): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const m = req.method;
    const needDb = () => {
      if (!env.DB) throw notConfigured("The database (binding DB)");
      return createRepo(env.DB);
    };
    const deps = (repo: ReturnType<typeof createRepo>): ServiceDeps => ({ env, repo, fetch: fetchImpl, sleep, now, ctx });

    // ---- public, no storage needed ----
    if (m === "GET" && path === "/v1/models") return jsonRes(200, modelList(env), { "cache-control": "public, max-age=60" });
    if (m === "GET" && path === "/openapi.json") return jsonRes(200, openapi(url.origin, env));
    if (m === "GET" && path === "/.well-known/x402") return jsonRes(200, wellKnownX402(url.origin, env));
    if (m === "GET" && path === "/llms.txt") return new Response(llmsTxt(url.origin, env), { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (m === "GET" && path === "/") return jsonRes(200, { name: "Forge402 router", docs: url.origin + "/llms.txt", openapi: url.origin + "/openapi.json" });
    if (path === "/mcp") return handleMcp(req, env, (r) => route(r, env, ctx).catch(errorRes));

    if (m === "GET" && path === "/v1/stats") {
      const range = url.searchParams.get("range") ?? "7d";
      if (!(range in RANGES)) throw new ApiError(400, "bad_request", "range must be 7d, 30d, 90d or all.");
      return jsonRes(200, await statsFor(needDb(), range, now(), env), { "cache-control": "public, max-age=30" });
    }

    // ---- everything below needs the database ----
    const repo = needDb();
    const d = deps(repo);
    const pd: PayDeps = d;

    if (m === "POST" && path === "/v1/chat/completions") {
      const body = await readJson(req);
      const r = parseChat(body);
      const authed = req.headers.get("authorization");
      // Pay-per-call answers go out only after the payment settles; a stream would hand over the answer first.
      if (!authed && r.stream) throw new ApiError(400, "bad_request", "stream: true needs a prepaid key (Authorization: Bearer forge_sk_...). Pay-per-call answers are sent whole, after the payment settles.");
      const payer = authed
        ? keyPayer(repo, await acc.keyFromRequest(req, pd), now)
        : x402Payer(req, `Forge402 chat: ${r.model.id}, token ceiling ${ceilingMicro(r.model, r.estIn, r.maxTokens)} micro-USDG`, pd);
      return runChat(env, req, r, payer, d, { allowCache: true });
    }
    if (m === "POST" && path === "/v1/embeddings") {
      const { model, inputs } = parseEmbeddings(await readJson(req));
      const payer = req.headers.get("authorization") ? keyPayer(repo, await acc.keyFromRequest(req, pd), now) : x402Payer(req, `Forge402 embeddings: ${model.id}`, pd);
      return runEmbeddings(env, model, inputs, payer, d);
    }
    if (m === "POST" && path === "/v1/playground/chat") return playgroundChat(req, env, await readJson(req), d);

    if (m === "POST" && path === "/v1/keys") return acc.createKeyRoute(req, await readJson(req), pd);
    if (m === "POST" && path === "/v1/keys/topup") return acc.topupRoute(req, await readJson(req), pd);
    if (m === "GET" && path === "/v1/keys/me") return acc.keyMe(req, pd);
    if (m === "DELETE" && path === "/v1/keys/me") return acc.deleteKeyMe(req, pd);

    if (m === "POST" && (path === "/v1/auth/nonce" || path === "/v1/auth/verify")) {
      // Sign-in endpoints are rate limited per caller (hashed IP), 100 a day.
      const scope = "auth:" + (await sha256Hex(callerKey(req))).slice(0, 16);
      if (!(await repo.takeDaily(scope, acc.utcDay(now()), 100))) throw new ApiError(429, "rate_limited", "Too many sign-in attempts today. Try again tomorrow (UTC).");
      const body = await readJson(req);
      return path.endsWith("nonce") ? acc.authNonce(req, env, body, pd) : acc.authVerify(env, body, pd);
    }
    if (m === "GET" && path === "/v1/wallet") return acc.walletInfo(req, env, pd);
    const close = /^\/v1\/wallet\/keys\/([A-Za-z0-9_]+)\/close$/.exec(path);
    if (m === "POST" && close) return acc.walletCloseKey(req, env, close[1], pd);

    throw new ApiError(404, "not_found", `No route for ${m} ${path}.`);
  }

  return {
    async fetch(req: Request, env: Env, ctx?: Ctx): Promise<Response> {
      const cors = corsHeaders(req, env);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      let res: Response;
      try {
        if (plainHttp(new URL(req.url))) throw new ApiError(400, "https_required", "Use https://. Plain http is refused so keys never travel in the clear.");
        res = await route(req, env, ctx);
      } catch (e) {
        res = errorRes(e);
      }
      // Responses from fetch/stubs can be immutable: copy before adding headers.
      const out = new Response(res.body, { status: res.status, headers: res.headers });
      for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...cors })) out.headers.set(k, v);
      return out;
    },
  };
}

export default makeWorker();
