// Chat and embeddings: the business flow around one model call. Router calls in, repo and payer do the money.
import type { Ctx, Env } from "./env.ts";
import { ApiError, notConfigured } from "./errors.ts";
import type { Payer } from "./billing.ts";
import { addNeurons, capacityReached, gateAi, isCfDailyLimit, kvWriteSlot, neuronsFor } from "./capacity.ts";
import { utcDay } from "./accounts.ts";
import { cacheGet, cacheKey, cacheMode, cachePut, type Cached } from "./cache.ts";
import { discountPct } from "./holder.ts";
import {
  aiInput, chatResponse, embeddingTokens, embeddingsResponse, isEmptyReply, newId, openAiStream, parseUpstream, usageObj, type ChatRequest,
} from "./openai.ts";
import type { Model } from "./models.ts";
import { billMicro, ceilingMicro, cfCostMicro, costMicro, estimateTokens, usd } from "./pricing.ts";
import type { PayDeps } from "./pay.ts";
import { jsonRes } from "./pay.ts";

export type ServiceDeps = PayDeps & { ctx?: Ctx };

const hdr = (model: string, cache: string, actual: number | null, discount: number, extra: Record<string, string> = {}): Record<string, string> => ({
  "x-forge-model": model,
  "x-forge-cache": cache,
  "x-forge-discount-pct": String(discount),
  ...(actual === null ? {} : { "x-forge-cost-usd": usd(actual) }),
  ...extra,
});

// Upstream trouble: a busy model is 429 (retry), anything else is 502. Neither is billed.
function upstreamError(e: unknown): ApiError {
  const msg = e instanceof Error ? e.message : "";
  if (isCfDailyLimit(e)) return capacityReached();
  if (/capacity|overload|busy|3040|too many/i.test(msg)) return new ApiError(429, "model_overloaded", "The model is at capacity. Retry in a few seconds. You were not charged.");
  return new ApiError(502, "upstream_error", "The model is temporarily unavailable. You were not charged.");
}

async function logLedger(d: ServiceDeps, e: Parameters<ServiceDeps["repo"]["addLedger"]>[0]): Promise<void> {
  try {
    await d.repo.addLedger(e);
  } catch (err) {
    console.error("ledger write failed", err instanceof Error ? err.message : "unknown"); // the call already succeeded
  }
}

export async function runChat(env: Env, req: Request, r: ChatRequest, payer: Payer, d: ServiceDeps, opts: { allowCache: boolean }): Promise<Response> {
  if (!env.AI) throw notConfigured("Workers AI (binding AI)");
  const m = r.model;
  const day = utcDay(d.now());
  await gateAi(d.repo, env, day, payer.free, m);
  const ceiling = ceilingMicro(m, r.estIn, r.maxTokens);
  const early = await payer.reserve(ceiling);
  if (early) return early;

  const discount = payer.free ? 0 : await discountPct(env, payer.owner, d.fetch);
  // ponytail: a discounted charge never drops below Cloudflare cost (break-even floor); a cache hit runs no model, so no floor.
  // The ceiling still caps it (it is what the caller signed or reserved); the estimate overshoots, so the floor fits under it.
  const bill = (tin: number, tout: number, hit = false) =>
    payer.free ? 0 : Math.min(ceiling, Math.max(hit ? 0 : cfCostMicro(m, tin, tout), billMicro(costMicro(m, tin, tout), { hit, discountPct: discount })));
  const honestIn = estimateTokens(JSON.stringify(r.messages));
  const mode = opts.allowCache ? cacheMode(req.headers.get("x-forge-cache"), r.temperature, r.stream) : "bypass";
  const key = mode === "eligible" ? await cacheKey(payer.tenant, r.body) : null;
  const created = Math.floor(d.now() / 1000);
  const id = newId();

  let done = false; // money already settled: the error path below must not settle a second time
  const settle = async (tin: number, tout: number, produced: boolean, cache: "HIT" | "MISS" | "BYPASS") => {
    if (cache !== "HIT") await addNeurons(d.repo, day, neuronsFor(m, tin, tout), payer.free); // a cache hit runs no model
    const actual = produced ? bill(tin, tout, cache === "HIT") : 0;
    done = true;
    const fin = await payer.finish(actual, produced);
    if ("fail" in fin) return { fin, actual };
    if (produced) {
      await logLedger(d, { ts: d.now(), tenant: payer.tenant, model: m.id, tokens_in: tin, tokens_out: tout, cost_micro: actual, cache, discount_pct: discount });
    }
    return { fin, actual };
  };

  try {
    // ---- cache hit ----
    if (key) {
      const hit = await cacheGet(env.CACHE, key);
      if (hit) {
        const { fin, actual } = await settle(hit.tokens_in, hit.tokens_out, true, "HIT");
        if ("fail" in fin) return fin.fail;
        const p = { text: hit.text, reasoning: hit.reasoning ?? null, toolCalls: hit.tool_calls as never, finish: hit.finish_reason };
        return jsonRes(200, chatResponse(id, created, m.id, p, hit.tokens_in, hit.tokens_out), hdr(m.id, "HIT", actual, discount, fin.headers));
      }
    }
    const cacheLabel = key ? "MISS" : "BYPASS";

    // ---- streaming ----
    if (r.stream) {
      const upstream = (await env.AI.run(m.cfModel, aiInput(r))) as ReadableStream<Uint8Array> | undefined;
      if (!upstream || typeof (upstream as ReadableStream).getReader !== "function") throw new ApiError(502, "upstream_error", "The model did not stream. You were not charged.");
      const body = openAiStream({
        upstream, id, created, model: m.id, estIn: honestIn, maxTokens: r.maxTokens,
        settle: async (u) => ({ costMicro: (await settle(u.tokensIn, u.tokensOut, u.produced, "BYPASS")).actual }),
        waitUntil: d.ctx?.waitUntil?.bind(d.ctx),
      });
      // The charge is only known when the stream ends: it rides in the final usage chunk (and X-Forge-Cost-Usd is absent).
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", ...hdr(m.id, "BYPASS", null, discount) } });
    }

    // ---- plain call ----
    const raw = await env.AI.run(m.cfModel, aiInput(r));
    const p = parseUpstream(raw, r.maxTokens);
    const empty = isEmptyReply(p);
    const tin = p.usage?.tokensIn ?? honestIn;
    const tout = Math.min(p.usage?.tokensOut ?? estimateTokens((p.reasoning ?? "") + (p.text ?? JSON.stringify(p.toolCalls ?? ""))), r.maxTokens);
    const { fin, actual } = await settle(tin, tout, !empty, cacheLabel);
    if ("fail" in fin) return fin.fail;
    if (key && !empty) {
      const entry: Cached = { text: p.text, reasoning: p.reasoning, tool_calls: p.toolCalls, finish_reason: p.finish, tokens_in: tin, tokens_out: tout };
      const put = kvWriteSlot(d.repo, day).then((ok) => (ok ? cachePut(env.CACHE, key, entry) : undefined));
      if (d.ctx?.waitUntil) d.ctx.waitUntil(put);
      else await put;
    }
    return jsonRes(200, chatResponse(id, created, m.id, p, empty ? 0 : tin, empty ? 0 : tout), hdr(m.id, cacheLabel, actual, discount, fin.headers));
  } catch (e) {
    // The model failed (or something threw) before an answer: give the reservation back, never charge.
    if (!done) await payer.finish(0, false).catch(() => undefined);
    throw e instanceof ApiError ? e : upstreamError(e);
  }
}

export async function runEmbeddings(env: Env, m: Model, inputs: string[], payer: Payer, d: ServiceDeps): Promise<Response> {
  if (!env.AI) throw notConfigured("Workers AI (binding AI)");
  const day = utcDay(d.now());
  await gateAi(d.repo, env, day, payer.free, m);
  const tokens = embeddingTokens(inputs);
  const exact = Math.max(1, costMicro(m, tokens, 0)); // known before the call, so the ceiling is the price
  const early = await payer.reserve(exact);
  if (early) return early;
  const discount = payer.free ? 0 : await discountPct(env, payer.owner, d.fetch);
  let done = false;
  try {
    const raw = (await env.AI.run(m.cfModel, { text: inputs })) as { data?: unknown };
    await addNeurons(d.repo, day, neuronsFor(m, tokens, 0), payer.free);
    const vectors = raw?.data;
    const ok = Array.isArray(vectors) && vectors.length === inputs.length && vectors.every((v) => Array.isArray(v) && v.length > 0);
    if (!ok) throw new ApiError(502, "upstream_error", "The embedding model returned no vectors. You were not charged.");
    const actual = Math.min(exact, Math.max(cfCostMicro(m, tokens, 0), billMicro(exact, { discountPct: discount }))); // break-even floor
    done = true;
    const fin = await payer.finish(actual, true);
    if ("fail" in fin) return fin.fail;
    await logLedger(d, { ts: d.now(), tenant: payer.tenant, kind: "embeddings", model: m.id, tokens_in: tokens, tokens_out: 0, cost_micro: actual, cache: "BYPASS", discount_pct: discount });
    return jsonRes(200, embeddingsResponse(m.id, vectors as number[][], tokens), hdr(m.id, "BYPASS", actual, discount, fin.headers));
  } catch (e) {
    if (!done) await payer.finish(0, false).catch(() => undefined);
    throw e instanceof ApiError ? e : upstreamError(e);
  }
}

export { usageObj };
