// OpenAI wire format: request validation, mapping to and from Workers AI, response shape, SSE chunks.
import { ApiError } from "./errors.ts";
import { findModel, type Model } from "./models.ts";
import { DEFAULT_MAX_TOKENS, estimateInputTokens, estimateTokens } from "./pricing.ts";

export type ChatRequest = {
  model: Model;
  body: Record<string, unknown>; // the validated body as sent, used for cache keying
  messages: unknown[];
  maxTokens: number;
  temperature?: number;
  topP?: number;
  tools?: unknown[];
  stream: boolean;
  estIn: number;
};

const ROLES = new Set(["system", "developer", "user", "assistant", "tool"]);
const bad = (m: string) => new ApiError(400, "bad_request", m);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseChat(raw: unknown, opts: { maxTokensCap?: number } = {}): ChatRequest {
  if (!isObj(raw)) throw bad("Send a JSON object body.");
  const model = findModel(raw.model);
  if (!model) throw new ApiError(404, "model_not_found", `No model called ${JSON.stringify(String(raw.model ?? ""))}. See GET /v1/models.`);
  if (model.type !== "chat") throw bad(`${model.id} is an embeddings model. Use POST /v1/embeddings.`);
  const { messages } = raw;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 500) throw bad("messages must be an array of 1 to 500 items.");
  let hasImage = false;
  for (const m of messages) {
    if (!isObj(m) || typeof m.role !== "string" || !ROLES.has(m.role)) throw bad("Every message needs a role: system, developer, user, assistant or tool.");
    const c = m.content;
    if (Array.isArray(c)) hasImage ||= c.some((p) => isObj(p) && p.type === "image_url");
    else if (c !== null && c !== undefined && typeof c !== "string") throw bad("message content must be a string or an array of parts.");
  }
  if (hasImage && !model.tags.includes("vision")) throw bad(`${model.id} does not accept images.`);

  const mt = raw.max_tokens ?? raw.max_completion_tokens;
  let maxTokens = DEFAULT_MAX_TOKENS;
  if (mt !== undefined) {
    if (!Number.isInteger(mt) || (mt as number) < 1) throw bad("max_tokens must be a positive integer.");
    maxTokens = mt as number;
  }
  if (maxTokens > model.context) throw bad(`max_tokens is larger than the ${model.context} token window of ${model.id}.`);
  if (opts.maxTokensCap) maxTokens = Math.min(maxTokens, opts.maxTokensCap);

  const num = (v: unknown, name: string, lo: number, hi: number): number | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !(v >= lo && v <= hi)) throw bad(`${name} must be a number from ${lo} to ${hi}.`);
    return v;
  };
  const temperature = num(raw.temperature, "temperature", 0, 2);
  const topP = num(raw.top_p, "top_p", 0, 1);
  if (raw.stream !== undefined && typeof raw.stream !== "boolean") throw bad("stream must be true or false.");
  if (raw.tools !== undefined && !Array.isArray(raw.tools)) throw bad("tools must be an array.");
  return {
    model, body: raw, messages, maxTokens, temperature, topP,
    tools: raw.tools as unknown[] | undefined,
    stream: raw.stream === true,
    estIn: estimateInputTokens({ messages, tools: raw.tools }, messages.length),
  };
}

// What goes to env.AI.run. Only fields every chat model accepts, so an extra OpenAI option cannot make a call fail.
export function aiInput(r: ChatRequest): Record<string, unknown> {
  const input: Record<string, unknown> = { messages: r.messages, max_tokens: r.maxTokens };
  if (r.temperature !== undefined) input.temperature = r.temperature;
  if (r.topP !== undefined) input.top_p = r.topP;
  if (r.tools?.length) input.tools = r.tools;
  if (r.stream) input.stream = true;
  return input;
}

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type Parsed = { text: string | null; reasoning?: string | null; toolCalls?: ToolCall[]; usage: { tokensIn: number; tokensOut: number } | null; finish: string };

const argString = (a: unknown): string => (typeof a === "string" ? a : JSON.stringify(a ?? {}));
const toolCalls = (list: unknown): ToolCall[] | undefined => {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list.map((t: any, i) => ({
    id: typeof t?.id === "string" ? t.id : `call_${i}`,
    type: "function" as const,
    function: { name: String(t?.function?.name ?? t?.name ?? ""), arguments: argString(t?.function?.arguments ?? t?.arguments) },
  }));
};
const usageOf = (u: any): Parsed["usage"] =>
  u && Number.isFinite(u.prompt_tokens) && Number.isFinite(u.completion_tokens) ? { tokensIn: Math.max(0, u.prompt_tokens), tokensOut: Math.max(0, u.completion_tokens) } : null;

// Workers AI answers either { response, usage, tool_calls } or the OpenAI shape { choices:[{message}], usage }.
export function parseUpstream(r: unknown, maxTokens: number): Parsed {
  const o = (isObj(r) ? r : {}) as any;
  const choice = o.choices?.[0];
  const msg = choice?.message;
  const text = msg ? msg.content : o.response;
  const calls = toolCalls(msg ? msg.tool_calls : o.tool_calls);
  const usage = usageOf(o.usage);
  const t = typeof text === "string" ? text : text === null || text === undefined ? null : JSON.stringify(text);
  // Reasoning models (gemma-4, gpt-oss, qwq...) put their thinking in reasoning_content; it is real output, passed through.
  const rz = msg ? (msg.reasoning_content ?? msg.reasoning) : o.reasoning_content;
  const reasoning = typeof rz === "string" && rz.trim() ? rz : null;
  const finish = calls ? "tool_calls" : choice?.finish_reason === "length" || (usage && usage.tokensOut >= maxTokens) ? "length" : "stop";
  return { text: t && t.length ? t : null, reasoning, toolCalls: calls, usage, finish };
}
export const isEmptyReply = (p: Pick<Parsed, "text" | "toolCalls" | "reasoning">): boolean => !(p.text && p.text.trim()) && !p.reasoning && !p.toolCalls?.length;

export type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };
export const usageObj = (tokensIn: number, tokensOut: number): Usage => ({ prompt_tokens: tokensIn, completion_tokens: tokensOut, total_tokens: tokensIn + tokensOut });
export const newId = (): string => "chatcmpl-" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);

export function chatResponse(id: string, created: number, model: string, p: Pick<Parsed, "text" | "toolCalls" | "finish" | "reasoning">, tokensIn: number, tokensOut: number) {
  return {
    id, object: "chat.completion", created, model,
    choices: [{ index: 0, message: { role: "assistant", content: p.text, ...(p.reasoning ? { reasoning_content: p.reasoning } : {}), ...(p.toolCalls ? { tool_calls: p.toolCalls } : {}) }, finish_reason: p.finish }],
    usage: usageObj(tokensIn, tokensOut),
  };
}

export function embeddingsResponse(model: string, vectors: number[][], tokens: number) {
  return {
    object: "list",
    data: vectors.map((embedding, index) => ({ object: "embedding", index, embedding })),
    model,
    usage: { prompt_tokens: tokens, total_tokens: tokens },
  };
}

// Embedding models report no token counts: ceil(bytes / 4) per input, billed at the posted input rate.
export const embeddingTokens = (inputs: string[]): number => inputs.reduce((n, s) => n + estimateTokens(s), 0);

export function parseEmbeddings(raw: unknown): { model: Model; inputs: string[] } {
  if (!isObj(raw)) throw bad("Send a JSON object body.");
  const model = findModel(raw.model);
  if (!model) throw new ApiError(404, "model_not_found", `No model called ${JSON.stringify(String(raw.model ?? ""))}. See GET /v1/models.`);
  if (model.type !== "embeddings") throw bad(`${model.id} is a chat model. Use POST /v1/chat/completions.`);
  const inputs = typeof raw.input === "string" ? [raw.input] : raw.input;
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 256 || !inputs.every((s) => typeof s === "string" && s.length > 0)) {
    throw bad("input must be a non-empty string or an array of 1 to 256 non-empty strings.");
  }
  return { model, inputs: inputs as string[] };
}

// ---- SSE ----

const enc = new TextEncoder();
const sse = (obj: unknown): Uint8Array => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
const DONE = enc.encode("data: [DONE]\n\n");

export const deltaChunk = (id: string, created: number, model: string, delta: Record<string, unknown>, finish: string | null = null) => ({
  id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }],
});

// One upstream SSE event in, what it carries out. Handles { response } and OpenAI { choices:[{delta}] } events.
export function readEvent(data: any): { text: string; reasoning: string; toolCalls?: ToolCall[]; usage: Parsed["usage"]; finish?: string } {
  const choice = data?.choices?.[0];
  const text = choice ? choice.delta?.content : data?.response;
  const rz = choice ? (choice.delta?.reasoning_content ?? choice.delta?.reasoning) : data?.reasoning_content;
  const calls = toolCalls(choice ? choice.delta?.tool_calls : data?.tool_calls);
  return { text: typeof text === "string" ? text : "", reasoning: typeof rz === "string" ? rz : "", toolCalls: calls, usage: usageOf(data?.usage), finish: typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined };
}

export type StreamResult = { tokensIn: number; tokensOut: number; produced: boolean };

// Wraps the upstream byte stream into OpenAI chat.completion.chunk events: a role chunk, content deltas, a finish
// chunk, then a final usage chunk (with the charge under `forge`) and [DONE]. `settle` runs once the model is done,
// before the usage chunk, so the charge in it is the real one. Real token counts are used when the model sends them.
export function openAiStream(o: {
  upstream: ReadableStream<Uint8Array>;
  id: string;
  created: number;
  model: string;
  estIn: number;
  maxTokens: number;
  settle: (r: StreamResult) => Promise<{ costMicro: number }>;
  // Keeps the read-and-settle work alive after the client disconnects, so the charge and ledger row always land.
  waitUntil?: (p: Promise<unknown>) => void;
}): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const work = (async () => {
      let open = true;
      const send = (b: Uint8Array) => {
        if (!open) return;
        try {
          controller.enqueue(b);
        } catch {
          open = false; // client went away: keep reading so the call is still counted and billed
        }
      };
      send(sse(deltaChunk(o.id, o.created, o.model, { role: "assistant", content: "" })));
      let text = "";
      let thought = "";
      let calls = 0;
      // Workers AI sends usage on every chunk. Some models count per chunk (granite: 32,0 then 0,1 / 0,1 / 0,0), others
      // send a running total or one final total. Prompt = largest seen; completion = sum when the counts repeat or drop
      // (per-chunk deltas), the largest when they only ever grow (a running total).
      let seenUsage = false, inMax = 0, outMax = 0, outSum = 0, outLast = -1, outGrowing = true;
      let finish = "stop";
      try {
        const reader = o.upstream.getReader();
        const dec = new TextDecoder();
        let buf = "";
        const handle = (line: string) => {
          if (!line.startsWith("data:")) return;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") return;
          let ev: ReturnType<typeof readEvent>;
          try {
            ev = readEvent(JSON.parse(payload));
          } catch {
            return;
          }
          if (ev.usage) {
            seenUsage = true;
            inMax = Math.max(inMax, ev.usage.tokensIn);
            outSum += ev.usage.tokensOut;
            outMax = Math.max(outMax, ev.usage.tokensOut);
            if (ev.usage.tokensOut <= outLast) outGrowing = false;
            outLast = ev.usage.tokensOut;
          }
          if (ev.finish) finish = ev.finish;
          if (ev.reasoning) {
            thought += ev.reasoning;
            send(sse(deltaChunk(o.id, o.created, o.model, { reasoning_content: ev.reasoning })));
          }
          if (ev.text) {
            text += ev.text;
            send(sse(deltaChunk(o.id, o.created, o.model, { content: ev.text })));
          }
          if (ev.toolCalls) {
            send(sse(deltaChunk(o.id, o.created, o.model, { tool_calls: ev.toolCalls.map((t, i) => ({ index: calls + i, ...t })) })));
            calls += ev.toolCalls.length;
            finish = "tool_calls";
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            handle(buf.slice(0, nl).trim());
            buf = buf.slice(nl + 1);
          }
        }
        handle(buf.trim());
      } catch {
        // upstream broke mid-stream: bill what was produced and end the stream cleanly
      }
      const reportedOut = outGrowing ? outMax : outSum;
      const tokensIn = seenUsage && inMax > 0 ? inMax : o.estIn;
      // A reply with text but a zero count is never billed as free: fall back to the text estimate.
      const tokensOut = Math.min(seenUsage && reportedOut > 0 ? reportedOut : estimateTokens(thought + text), Math.max(o.maxTokens, 1));
      const produced = text.trim().length > 0 || thought.trim().length > 0 || calls > 0;
      const out = produced ? tokensOut : 0;
      send(sse(deltaChunk(o.id, o.created, o.model, {}, finish)));
      let costMicro = 0;
      try {
        costMicro = (await o.settle({ tokensIn: produced ? tokensIn : 0, tokensOut: out, produced })).costMicro;
      } catch (e) {
        console.error("stream settle failed", e instanceof Error ? e.message : "unknown");
      }
      send(sse({ id: o.id, object: "chat.completion.chunk", created: o.created, model: o.model, choices: [], usage: { ...usageObj(produced ? tokensIn : 0, out), cost_usd: costMicro / 1_000_000 }, forge: { cost_usd: costMicro / 1_000_000 } }));
      send(DONE);
      if (open) controller.close();
      })();
      o.waitUntil?.(work);
      return work;
    },
  });
}
