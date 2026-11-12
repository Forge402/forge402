import { describe, expect, test } from "vitest";
import { budgets, neuronsFor } from "../src/capacity.ts";
import { utcDay } from "../src/accounts.ts";
import { findModel, freeModelIds } from "../src/models.ts";
import { chatBody, fundedKey, harness } from "./helpers.ts";

const day = (h: ReturnType<typeof harness>) => utcDay(h.clock.now());
const chat = (h: ReturnType<typeof harness>, key: string, body = chatBody({ max_tokens: 1000 })) => h.call("/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}` }, json: body });
const pg = (h: ReturnType<typeof harness>, body: unknown, ip = "1.2.3.4") => h.call("/v1/playground/chat", { method: "POST", headers: { "cf-connecting-ip": ip }, json: body });

describe("neuron budget", () => {
  test("math: granite 1000 in + 500 out = ceil(73 / 11) ... from Cloudflare prices", () => {
    const m = findModel("granite-4.0-micro")!;
    // (1000*0.017 + 500*0.112) / 1e6 / 0.000011 = 6.636...
    expect(neuronsFor(m, 1000, 500)).toBe(7);
    expect(neuronsFor(m, 0, 0)).toBe(0);
  });
  test("env parsing: defaults, 0 = uncapped", () => {
    expect(budgets({})).toEqual({ all: 7500, free: 2000 });
    expect(budgets({ AI_DAILY_NEURONS: "abc", FREE_DAILY_NEURONS: "-3" })).toEqual({ all: 7500, free: 2000 });
    expect(budgets({ AI_DAILY_NEURONS: "0", FREE_DAILY_NEURONS: "50" })).toEqual({ all: 0, free: 50 });
  });
  test("a real call adds its neurons to neurons:all", async () => {
    const h = harness({}, () => ({ response: "ok", usage: { prompt_tokens: 1000, completion_tokens: 500 } }));
    const { key } = await fundedKey(h, 1_000_000);
    expect((await chat(h, key)).status).toBe(200);
    expect(await h.repo.usedDaily("neurons:all", day(h))).toBe(7);
    expect(await h.repo.usedDaily("neurons:free", day(h))).toBe(0);
  });
  test("cache HIT adds 0 neurons", async () => {
    const h = harness({}, () => ({ response: "ok", usage: { prompt_tokens: 1000, completion_tokens: 500 } }));
    const { key } = await fundedKey(h, 1_000_000);
    const body = chatBody({ temperature: 0, max_tokens: 1000 });
    expect((await chat(h, key, body)).headers.get("x-forge-cache")).toBe("MISS");
    expect((await chat(h, key, body)).headers.get("x-forge-cache")).toBe("HIT");
    expect(await h.repo.usedDaily("neurons:all", day(h))).toBe(7);
    expect(h.aiCalls.length).toBe(1);
  });
  test("embeddings count neurons", async () => {
    const h = harness({}, () => ({ data: [[0.1, 0.2]] }));
    const { key } = await fundedKey(h, 1_000_000);
    const r = await h.call("/v1/embeddings", { method: "POST", headers: { authorization: `Bearer ${key}` }, json: { model: "bge-m3", input: "hello world" } });
    expect(r.status).toBe(200);
    expect(await h.repo.usedDaily("neurons:all", day(h))).toBeGreaterThanOrEqual(1);
  });
  test("at the limit: 503 capacity_reached, no AI call, key never reserved or charged", async () => {
    const h = harness({ AI_DAILY_NEURONS: "10" });
    const { key, id } = await fundedKey(h, 1_000_000);
    await h.repo.addDaily("neurons:all", day(h), 10);
    const r = await chat(h, key);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toEqual({ code: "capacity_reached", message: "Today's model capacity is used up. It resets at 00:00 UTC. You were not charged." });
    expect(h.aiCalls.length).toBe(0);
    const row = await h.repo.keyById(id);
    expect([row!.balance_micro, row!.spent_micro, row!.calls]).toEqual([1_000_000, 0, 0]);
  });
  test("free plan: a paid-plan-only model is 404, no AI call, key untouched; paid plan serves it", async () => {
    const h = harness();
    const { key, id } = await fundedKey(h, 1_000_000);
    const r = await chat(h, key, chatBody({ model: "kimi-k2.6", max_tokens: 100 }));
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe("model_not_found");
    expect(h.aiCalls.length).toBe(0);
    const row = await h.repo.keyById(id);
    expect([row!.balance_micro, row!.spent_micro, row!.calls]).toEqual([1_000_000, 0, 0]);
    expect(freeModelIds().has("kimi-k2.6")).toBe(false);
    const p = harness({ AI_DAILY_NEURONS: "0" });
    const k2 = await fundedKey(p, 1_000_000);
    expect((await chat(p, k2.key, chatBody({ model: "kimi-k2.6", max_tokens: 100 }))).status).toBe(200);
  });
  test("x402 caller is gated before any payment step", async () => {
    const h = harness({ AI_DAILY_NEURONS: "1" });
    await h.repo.addDaily("neurons:all", day(h), 1);
    const r = await h.call("/v1/chat/completions", { method: "POST", json: chatBody() });
    expect(r.status).toBe(503); // not 402: no payment was requested
    expect(h.fac.calls).toEqual([]);
  });
  test("AI_DAILY_NEURONS=0 means no cap", async () => {
    const h = harness({ AI_DAILY_NEURONS: "0" });
    const { key } = await fundedKey(h, 1_000_000);
    await h.repo.addDaily("neurons:all", day(h), 999_999);
    expect((await chat(h, key)).status).toBe(200);
  });
  test("playground: free share used up -> 429 rate_limited, paid keys still work", async () => {
    const h = harness({ FREE_DAILY_NEURONS: "5" });
    const model = [...freeModelIds()][0];
    await h.repo.addDaily("neurons:free", day(h), 5);
    const r = await pg(h, chatBody({ model }));
    expect(r.status).toBe(429);
    expect((await r.json()).error.code).toBe("rate_limited");
    expect(h.aiCalls.length).toBe(0);
    expect(await h.repo.usedDaily("ip:x", day(h))).toBe(0);
    const { key } = await fundedKey(h, 1_000_000);
    expect((await chat(h, key)).status).toBe(200);
  });
  test("playground call counts into both scopes", async () => {
    const h = harness({}, () => ({ response: "ok", usage: { prompt_tokens: 1000, completion_tokens: 500 } }));
    const model = [...freeModelIds()][0];
    expect((await pg(h, chatBody({ model }))).status).toBe(200);
    const all = await h.repo.usedDaily("neurons:all", day(h));
    expect(all).toBeGreaterThan(0);
    expect(await h.repo.usedDaily("neurons:free", day(h))).toBe(all);
  });
  test("Cloudflare's own daily limit error maps to capacity_reached, not billed", async () => {
    const h = harness({}, () => { throw new Error("3036: you have used up your daily free allocation of 10,000 neurons"); });
    const { key, id } = await fundedKey(h, 1_000_000);
    const r = await chat(h, key);
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("capacity_reached");
    expect((await h.repo.keyById(id))!.balance_micro).toBe(1_000_000);
  });
  test("a different upstream failure stays upstream_error", async () => {
    const h = harness({}, () => { throw new Error("boom"); });
    const { key } = await fundedKey(h, 1_000_000);
    expect((await (await chat(h, key)).json()).error.code).toBe("upstream_error");
  });
  test("KV cache writes stop at 900 a day, reads and answers still work", async () => {
    const h = harness();
    const { key } = await fundedKey(h, 1_000_000);
    await h.repo.addDaily("kv:writes", day(h), 900);
    const r = await chat(h, key, chatBody({ temperature: 0 }));
    expect(r.status).toBe(200);
    expect(h.kv.map.size).toBe(0);
    // with room left, the write happens and uses a slot
    const h2 = harness();
    const k2 = await fundedKey(h2, 1_000_000);
    await chat(h2, k2.key, chatBody({ temperature: 0 }));
    expect(h2.kv.map.size).toBe(1);
    expect(await h2.repo.usedDaily("kv:writes", day(h2))).toBe(1);
  });
  test("GET /v1/stats exposes capacity", async () => {
    const h = harness({ AI_DAILY_NEURONS: "100", FREE_DAILY_NEURONS: "40" });
    await h.repo.addDaily("neurons:all", day(h), 12);
    const s = await (await h.call("/v1/stats")).json();
    expect(s.capacity).toEqual({ day: day(h), neurons_used: 12, neurons_limit: 100, free_neurons_used: 0, free_neurons_limit: 40 });
    expect(s.calls).toBe(0);
    const u = await (await harness({ AI_DAILY_NEURONS: "0" }).call("/v1/stats")).json();
    expect(u.capacity.neurons_limit).toBeNull();
  });
});
