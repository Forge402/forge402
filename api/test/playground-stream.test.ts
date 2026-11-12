import { describe, expect, test } from "vitest";
import { harness } from "./helpers.ts";

// Real Workers AI SSE for @cf/ibm-granite/granite-4.0-h-micro (captured 2026-11-12): OpenAI chunks, per-chunk usage.
const GRANITE = [
  { id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }], usage: { prompt_tokens: 32, completion_tokens: 0, total_tokens: 32 } },
  { id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }], usage: { prompt_tokens: 0, completion_tokens: 1, total_tokens: 1 } },
  { id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "." }, finish_reason: null }], usage: { prompt_tokens: 0, completion_tokens: 1, total_tokens: 1 } },
  { id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
];
const sse = () => new ReadableStream<Uint8Array>({ start(c) { const e = new TextEncoder(); for (const ev of GRANITE) c.enqueue(e.encode(`data: ${JSON.stringify(ev)}\n\n`)); c.enqueue(e.encode("data: [DONE]\n\n")); c.close(); } });

describe("playground streaming with real granite chunks", () => {
  test("guest stream carries the text", async () => {
    const h = harness({}, () => sse());
    const r = await h.call("/v1/playground/chat", { method: "POST", headers: { "cf-connecting-ip": "1.2.3.4" }, json: { model: "granite-4.0-micro", messages: [{ role: "user", content: "Say OK" }], stream: true, stream_options: { include_usage: true } } });
    const body = await r.text();
    expect(r.status).toBe(200);
    expect(body).toContain('"content":"OK"');
    // per-chunk counts add up: 32 in, 2 out (was 0/0 before 2026-11-12, so keyed streams were billed nothing)
    expect(body).toContain('"usage":{"prompt_tokens":32,"completion_tokens":2,"total_tokens":34');
  });
  test("a keyed stream with per-chunk usage is billed for every token", async () => {
    const { fundedKey, chatBody } = await import("./helpers.ts");
    const h = harness({}, () => sse());
    const { key, id } = await fundedKey(h, 1_000_000);
    const r = await h.call("/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}` }, json: chatBody({ stream: true }) });
    await r.text();
    const row: any = await h.db.prepare("SELECT tokens_in, tokens_out, cost_usd FROM ledger WHERE tenant = ? ORDER BY id DESC LIMIT 1").bind(id).first();
    expect(row).toMatchObject({ tokens_in: 32, tokens_out: 2 });
    expect(row.cost_usd).toBeGreaterThan(0);
  });
  test("pay-per-call (x402) streaming is refused before any model call", async () => {
    const { chatBody } = await import("./helpers.ts");
    const h = harness({}, () => sse());
    const r = await h.call("/v1/chat/completions", { method: "POST", json: chatBody({ stream: true }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toContain("prepaid key");
    expect(h.aiCalls.length).toBe(0);
  });
});

describe("transport security (live review 2026-11-12)", () => {
  test("plain http is refused before any work; https carries HSTS and nosniff", async () => {
    const { makeWorker } = await import("../src/worker.ts");
    const h = harness();
    const w = makeWorker();
    const r = await w.fetch(new Request("http://api.forge402.pro/v1/models"), h.env);
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe("https_required");
    const ok = await h.call("/v1/models");
    expect(ok.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await w.fetch(new Request("http://localhost:8790/v1/models"), h.env)).status).toBe(200);
  });
});
