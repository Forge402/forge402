// Remote MCP server, stateless: every POST gets one JSON answer (no sessions). Adapted from the Reinkeep gate.
// Tools: list_models (free), chat (paid: key from the request's Authorization header or the `api_key` argument, else
// the 402 terms are returned), scan (proxied to the scan worker through the SCAN service binding).
import type { Env } from "./env.ts";
import { modelList } from "./models.ts";

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 64 * 1024;
type Result = { content: { type: "text"; text: string }[]; structuredContent?: unknown; isError?: boolean };
const text = (t: string, data?: unknown, isError = false): Result => ({
  content: [{ type: "text", text: t }],
  ...(data !== undefined ? { structuredContent: data } : {}),
  ...(isError ? { isError } : {}),
});
const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

const TOOLS = [
  { name: "list_models", description: "Every model with context length and price per 1M tokens. Free.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "chat",
    description: "Ask any model. Billed per token from a prepaid forge_sk_ key (header Authorization: Bearer ..., or api_key). The reply says what it cost.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string" },
        prompt: { type: "string", description: "Shortcut for one user message" },
        messages: { type: "array", items: { type: "object" } },
        max_tokens: { type: "integer" },
        temperature: { type: "number" },
        api_key: { type: "string", description: "forge_sk_ key, if not sent as a header" },
      },
      required: ["model"],
      additionalProperties: false,
    },
  },
  {
    name: "scan",
    description: "Risk read of one Robinhood Chain token, by the Forge Scan worker.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, payment_signature: { type: "string" } },
      required: ["address"],
      additionalProperties: false,
    },
  },
];

async function callTool(name: string, args: Record<string, any>, req: Request, env: Env, api: (r: Request) => Promise<Response>): Promise<Result | null> {
  if (name === "list_models") {
    const list = modelList(env);
    return text(JSON.stringify(list.data.map((m) => ({ id: m.id, type: m.type, context: m.context_length, in: m.input_usd_per_mtok, out: m.output_usd_per_mtok }))), list);
  }
  if (name === "chat") {
    const messages = Array.isArray(args.messages) ? args.messages : typeof args.prompt === "string" ? [{ role: "user", content: args.prompt }] : null;
    if (!messages) return text("Send prompt or messages.", undefined, true);
    const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": req.headers.get("cf-connecting-ip") ?? "" };
    const key = typeof args.api_key === "string" ? args.api_key : /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
    if (key) headers.authorization = `Bearer ${key}`;
    const body = { model: args.model, messages, max_tokens: args.max_tokens, temperature: args.temperature };
    const res = await api(new Request(new URL("/v1/chat/completions", req.url), { method: "POST", headers, body: JSON.stringify(body) }));
    const data: any = await res.json().catch(() => null);
    if (res.status === 402 && !key) {
      return text("Payment needed. Mint a prepaid key (POST /v1/keys, then pass api_key) or pay per call over REST with x402. Terms: " + JSON.stringify(data?.accepts ?? []), data, true);
    }
    if (!res.ok) return text(data?.error?.message ?? `Error ${res.status}`, data, true);
    return text(`${data.choices?.[0]?.message?.content ?? ""}\n\n(cost $${res.headers.get("x-forge-cost-usd")}, ${data.usage?.total_tokens} tokens)`, data);
  }
  if (name === "scan") {
    if (!env.SCAN) return text("Scanning is not configured on this server (the SCAN service binding is missing).", { error: { code: "not_configured" } }, true);
    // ponytail: free GET path unless a payment signature is passed; the scan worker owns its limits and pricing.
    const paid = typeof args.payment_signature === "string";
    const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": req.headers.get("cf-connecting-ip") ?? "" };
    if (paid) headers["payment-signature"] = args.payment_signature;
    const url = "https://scan.internal" + (paid ? "/v1/scan" : `/v1/scan/${args.address}`);
    const res = await env.SCAN.fetch(new Request(url, paid ? { method: "POST", headers, body: JSON.stringify({ address: args.address }) } : { headers }));
    const data = await res.json().catch(() => null);
    return text(JSON.stringify(data), data, !res.ok);
  }
  return null;
}

export async function handleMcp(req: Request, env: Env, api: (r: Request) => Promise<Response>): Promise<Response> {
  const h = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: h });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply(rpcErr(null, -32600, "Request too large"), 413);
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return reply(rpcErr(null, -32700, "Parse error"), 400);
  }
  const one = async (m: any): Promise<object | null> => {
    if (typeof m !== "object" || m === null || m.jsonrpc !== "2.0" || typeof m.method !== "string") return rpcErr(m?.id, -32600, "Invalid Request");
    if (m.id === undefined) return null; // notification
    switch (m.method) {
      case "initialize": {
        const asked = m.params?.protocolVersion;
        return { jsonrpc: "2.0", id: m.id, result: { protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: "forge402", version: "0.1.0" } } };
      }
      case "ping":
        return { jsonrpc: "2.0", id: m.id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id: m.id, result: { tools: TOOLS } };
      case "tools/call": {
        const r = await callTool(String(m.params?.name), m.params?.arguments ?? {}, req, env, api);
        return r ? { jsonrpc: "2.0", id: m.id, result: r } : rpcErr(m.id, -32602, `Unknown tool: ${m.params?.name}`);
      }
      default:
        return rpcErr(m.id, -32601, "Method not found");
    }
  };
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map(one))).filter(Boolean);
    return out.length ? reply(out) : new Response(null, { status: 202 });
  }
  const out = await one(msg);
  return out ? reply(out) : new Response(null, { status: 202 });
}
