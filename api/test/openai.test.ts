import { describe, expect, test } from "vitest";
import { chatResponse, isEmptyReply, openAiStream, parseChat, parseUpstream, readEvent } from "../src/openai.ts";
import { findModel, freeModelIds } from "../src/models.ts";
import { chatBody, fundedKey, harness } from "./helpers.ts";

const sseStream = (events: unknown[], raw?: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const e = new TextEncoder();
      for (const ev of events) c.enqueue(e.encode(`data: ${typeof ev === "string" ? ev : JSON.stringify(ev)}\n\n`));
      if (raw) c.enqueue(e.encode(raw));
      c.close();
    },
  });
const readAll = async (s: ReadableStream<Uint8Array>) => {
  const text = await new Response(s).text();
  return text.split("\n\n").filter(Boolean).map((l) => l.replace(/^data: /, ""));
};

describe("request validation", () => {
  test("rejects bad bodies with the right code", () => {
    expect(() => parseChat({ model: "nope", messages: [{ role: "user", content: "x" }] })).toThrow(/No model/);
    expect(() => parseChat({ model: "granite-4.0-micro", messages: [] })).toThrow(/messages/);
    expect(() => parseChat({ model: "granite-4.0-micro", messages: [{ role: "user", content: "x" }], max_tokens: 0 })).toThrow(/max_tokens/);
    expect(() => parseChat({ model: "bge-m3", messages: [{ role: "user", content: "x" }] })).toThrow(/embeddings/);
    expect(() => parseChat({ model: "granite-4.0-micro", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }] })).toThrow(/images/);
  });
  test("defaults max_tokens to 1024", () => expect(parseChat({ model: "granite-4.0-micro", messages: [{ role: "user", content: "x" }] }).maxTokens).toBe(1024));
});

describe("response shape", () => {
  test("parses both Workers AI shapes", () => {
    expect(parseUpstream({ response: "hi", usage: { prompt_tokens: 3, completion_tokens: 2 } }, 100)).toMatchObject({ text: "hi", usage: { tokensIn: 3, tokensOut: 2 }, finish: "stop" });
    expect(parseUpstream({ choices: [{ message: { content: "yo" }, finish_reason: "length" }] }, 100)).toMatchObject({ text: "yo", finish: "length", usage: null });
    const tools = parseUpstream({ response: null, tool_calls: [{ name: "f", arguments: { a: 1 } }] }, 100);
    expect(tools.toolCalls![0]).toMatchObject({ type: "function", function: { name: "f", arguments: '{"a":1}' } });
    expect(tools.finish).toBe("tool_calls");
  });
  test("reasoning model reply (real gemma-4 shape, 2026-11-12): thinking is output, not an empty reply", () => {
    const raw = { choices: [{ index: 0, message: { role: "assistant", content: "", reasoning_content: "Input: say hi..." }, finish_reason: "length" }], usage: { prompt_tokens: 22, completion_tokens: 400 } };
    const p = parseUpstream(raw, 400);
    expect(p).toMatchObject({ text: null, reasoning: "Input: say hi...", finish: "length", usage: { tokensIn: 22, tokensOut: 400 } });
    expect(isEmptyReply(p)).toBe(false);
    expect(chatResponse("c", 1, "m", p, 22, 400).choices[0].message).toMatchObject({ content: null, reasoning_content: "Input: say hi..." });
    expect(readEvent({ choices: [{ delta: { reasoning_content: "hmm" } }] }).reasoning).toBe("hmm");
  });
  test("playground guest set skips reasoning and vision models", () => {
    for (const id of freeModelIds()) {
      expect(findModel(id)!.tags).not.toContain("reasoning");
      expect(findModel(id)!.tags).not.toContain("vision");
    }
  });
  test("chat.completion object", () => {
    const o = chatResponse("chatcmpl-1", 10, "m", { text: "hi", finish: "stop" }, 3, 2);
    expect(o).toEqual({
      id: "chatcmpl-1", object: "chat.completion", created: 10, model: "m",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
  });
  test("endpoint returns that shape plus the X-Forge headers", async () => {
    const h = harness();
    const { key } = await fundedKey(h, 5_000_000);
    const r = await h.call("/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}` }, json: chatBody() });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.object).toBe("chat.completion");
    expect(j.choices[0].message).toEqual({ role: "assistant", content: "hello there" });
    expect(j.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    // 10 * 0.021 + 5 * 0.14 = 0.91 micro, rounded up to 1
    expect(r.headers.get("x-forge-cost-usd")).toBe("0.000001");
    expect(r.headers.get("x-forge-cache")).toBe("BYPASS");
    expect(r.headers.get("x-forge-discount-pct")).toBe("0");
    expect(r.headers.get("x-forge-model")).toBe("granite-4.0-micro");
    expect(h.aiCalls[0].model).toBe("@cf/ibm-granite/granite-4.0-h-micro");
  });
  test("embeddings: OpenAI shape, exact cost from ceil(bytes/4)", async () => {
    const h = harness({}, () => ({ data: [[0.1, 0.2], [0.3, 0.4]], shape: [2, 2] }));
    const { key } = await fundedKey(h, 1_000_000);
    const r = await h.call("/v1/embeddings", { method: "POST", headers: { authorization: `Bearer ${key}` }, json: { model: "bge-m3", input: ["abcd", "abcdefgh"] } });
    const j = await r.json();
    expect(j).toMatchObject({ object: "list", model: "bge-m3", usage: { prompt_tokens: 3, total_tokens: 3 } });
    expect(j.data[1]).toEqual({ object: "embedding", index: 1, embedding: [0.3, 0.4] });
    expect(r.headers.get("x-forge-cost-usd")).toBe("0.000001"); // 3 * 0.015 = 0.045 -> 1 micro
  });
});

describe("streaming chunks", () => {
  const run = async (events: unknown[], estIn = 7) => {
    let settled: unknown;
    const out = await readAll(
      openAiStream({ upstream: sseStream(events, "data: [DONE]\n\n"), id: "chatcmpl-x", created: 5, model: "m", estIn, maxTokens: 100, settle: async (r) => ((settled = r), { costMicro: 42 }) }),
    );
    return { out, settled };
  };
  test("role chunk, deltas, finish chunk, final usage chunk with cost, [DONE]", async () => {
    const { out, settled } = await run([{ response: "Hel" }, { response: "lo" }, { response: "", usage: { prompt_tokens: 9, completion_tokens: 2 } }]);
    expect(out.at(-1)).toBe("[DONE]");
    const c = out.slice(0, -1).map((s) => JSON.parse(s));
    expect(c[0]).toMatchObject({ object: "chat.completion.chunk", id: "chatcmpl-x", choices: [{ delta: { role: "assistant" }, finish_reason: null }] });
    expect(c[1].choices[0].delta.content).toBe("Hel");
    expect(c[2].choices[0].delta.content).toBe("lo");
    expect(c.at(-2).choices[0]).toEqual({ index: 0, delta: {}, finish_reason: "stop" });
    expect(c.at(-1).choices).toEqual([]);
    expect(c.at(-1).usage).toEqual({ prompt_tokens: 9, completion_tokens: 2, total_tokens: 11, cost_usd: 0.000042 });
    expect(settled).toEqual({ tokensIn: 9, tokensOut: 2, produced: true });
  });
  test("running-total usage counts once, not summed", async () => {
    const { settled } = await run([{ response: "a", usage: { prompt_tokens: 9, completion_tokens: 1 } }, { response: "b", usage: { prompt_tokens: 9, completion_tokens: 2 } }, { response: "c", usage: { prompt_tokens: 9, completion_tokens: 3 } }]);
    expect(settled).toEqual({ tokensIn: 9, tokensOut: 3, produced: true });
  });
  test("no upstream usage: estimates from the text (ceil(bytes/4))", async () => {
    const { settled } = await run([{ response: "abcdefgh" }], 7);
    expect(settled).toEqual({ tokensIn: 7, tokensOut: 2, produced: true });
  });
  test("OpenAI-style upstream events are understood", () => {
    expect(readEvent({ choices: [{ delta: { content: "x" }, finish_reason: null }] }).text).toBe("x");
    expect(readEvent({ choices: [{ delta: {}, finish_reason: "length" }] }).finish).toBe("length");
  });
  test("empty stream: not produced, zero tokens", async () => {
    const { settled } = await run([{ response: "" }]);
    expect(settled).toEqual({ tokensIn: 0, tokensOut: 0, produced: false });
  });
  test("end to end through the worker: SSE content type, billed once, ledger row", async () => {
    const h = harness({}, () => sseStream([{ response: "Hi" }, { response: " there", usage: { prompt_tokens: 12, completion_tokens: 3 } }]));
    const { key, id } = await fundedKey(h, 1_000_000);
    const r = await h.call("/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}` }, json: chatBody({ stream: true }) });
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const out = await readAll(r.body!);
    expect(out.at(-1)).toBe("[DONE]");
    const usage = JSON.parse(out.at(-2)!).usage;
    expect(usage).toMatchObject({ prompt_tokens: 12, completion_tokens: 3 });
    const row = (await h.repo.keyById(id))!;
    expect(row.calls).toBe(1);
    expect(row.balance_micro + row.spent_micro).toBe(1_000_000);
    expect(row.spent_micro).toBe(1); // 12*0.021 + 3*0.14 = 0.67 micro -> 1
  });
});
