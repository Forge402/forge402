// Agent-discovery documents, built from the real catalog and constants so they cannot drift from the code.
import { DEFAULT_MAX_TOKENS, refundMinMicro, settleFeeMicro, usd } from "./pricing.ts";
import { DEFAULT_FACILITATOR, NETWORK, USDG, X402_VERSION } from "./x402.ts";
import { freeModelIds, modelEntry, servedModels } from "./models.ts";
import type { Env } from "./env.ts";

const ROUTES = [
  { method: "GET", path: "/v1/models", pay: "free", summary: "Model catalog with posted prices (OpenAI list shape)." },
  { method: "POST", path: "/v1/chat/completions", pay: "per token", summary: "OpenAI chat completions; stream:true needs a forge_sk_ key. Pay with a key or x402 (x402 answers are sent whole, after settlement)." },
  { method: "POST", path: "/v1/embeddings", pay: "per token", summary: "OpenAI embeddings, exact cost." },
  { method: "POST", path: "/v1/keys", pay: "x402 deposit", summary: "Deposit 1 to 1000 USDG, get a prepaid forge_sk_ key (shown once). The x402 settlement fee is deducted from the deposit." },
  { method: "POST", path: "/v1/keys/topup", pay: "x402 deposit", summary: "Add balance to a key. The x402 settlement fee is deducted from the amount." },
  { method: "GET", path: "/v1/keys/me", pay: "key", summary: "Balance, spend and recent calls." },
  { method: "DELETE", path: "/v1/keys/me", pay: "key", summary: "Close the key; the rest is booked as a refund to the owner wallet." },
  { method: "GET", path: "/v1/stats", pay: "free", summary: "Usage totals from the ledger. ?range=7d|30d|90d|all" },
  { method: "POST", path: "/mcp", pay: "varies", summary: "Remote MCP server (list_models, chat, scan)." },
];

export function openapi(origin: string, env: Env) {
  const chat = { type: "object", required: ["model", "messages"], properties: { model: { type: "string" }, messages: { type: "array", items: { type: "object" } }, max_tokens: { type: "integer", default: DEFAULT_MAX_TOKENS }, temperature: { type: "number" }, stream: { type: "boolean" } } };
  const op = (summary: string, extra: object = {}) => ({ summary, responses: { 200: { description: "OK" }, 402: { description: "Payment required (x402 challenge in body and PAYMENT-REQUIRED header)" }, 503: { description: "capacity_reached: the daily model capacity is used up, resets 00:00 UTC, nothing charged" } }, ...extra });
  return {
    openapi: "3.1.0",
    info: { title: "Forge402 router", version: "0.1.0", description: "One OpenAI-compatible endpoint for many open models, billed per token in USDG on Robinhood Chain." },
    servers: [{ url: origin }],
    paths: {
      "/v1/models": { get: op("List models and prices") },
      "/v1/chat/completions": { post: op("Chat completion", { requestBody: { content: { "application/json": { schema: chat } } }, security: [{ forgeKey: [] }, {}], "x-payment": { protocol: "x402", version: X402_VERSION, network: NETWORK, asset: USDG, pricing: "ceiling = (estimated input + max_tokens at posted rate) + settlement fee (X-Forge-Settle-Fee-Usd); unused token part refunded, fee kept. Prepaid-key calls pay no fee." } }) },
      "/v1/embeddings": { post: op("Embeddings", { requestBody: { content: { "application/json": { schema: { type: "object", required: ["model", "input"], properties: { model: { type: "string" }, input: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] } } } } } } }) },
      "/v1/keys": { post: op("Create prepaid key", { requestBody: { content: { "application/json": { schema: { type: "object", required: ["amount_usd"], properties: { amount_usd: { type: "number", minimum: 1, maximum: 1000 }, label: { type: "string" } } } } } } }) },
      "/v1/keys/topup": { post: op("Top up a key", { security: [{ forgeKey: [] }] }) },
      "/v1/keys/me": { get: op("Key status", { security: [{ forgeKey: [] }] }), delete: op("Close key", { security: [{ forgeKey: [] }] }) },
      "/v1/stats": { get: op("Ledger stats", { parameters: [{ name: "range", in: "query", schema: { enum: ["7d", "30d", "90d", "all"] } }] }) },
    },
    components: { securitySchemes: { forgeKey: { type: "http", scheme: "bearer", description: "forge_sk_... prepaid key" } } },
    "x-pay-to-configured": /^0x[0-9a-fA-F]{40}$/.test(env.PAY_TO ?? ""),
  };
}

export function wellKnownX402(origin: string, env: Env) {
  const free = freeModelIds();
  return {
    x402Version: X402_VERSION,
    name: "Forge402",
    configured: /^0x[0-9a-fA-F]{40}$/.test(env.PAY_TO ?? ""),
    facilitator: env.FACILITATOR_URL?.trim() || DEFAULT_FACILITATOR,
    networks: [{ network: NETWORK, asset: USDG, name: "Global Dollar", decimals: 6 }],
    payTo: /^0x[0-9a-fA-F]{40}$/.test(env.PAY_TO ?? "") ? env.PAY_TO : null,
    endpoints: ROUTES.filter((r) => r.pay !== "free").map((r) => ({ method: r.method, url: origin + r.path, pay: r.pay, description: r.summary })),
    models: servedModels(env).map((m) => modelEntry(m, free)),
    settleFeeUsd: usd(settleFeeMicro(env)),
    openapi: origin + "/openapi.json",
  };
}

export function llmsTxt(origin: string, env: Env = {}): string {
  const fee = usd(settleFeeMicro(env)), refundMin = usd(refundMinMicro(env));
  return `# Forge402

> One OpenAI-compatible API for open AI models on Cloudflare Workers AI. Pay per token in USDG on Robinhood Chain (${NETWORK}), with a prepaid key or x402. Prices are the Cloudflare price plus 25%.

## Connect
- Base URL: ${origin}/v1 (works with OpenAI SDKs)
- OpenAPI: ${origin}/openapi.json
- x402 listing: ${origin}/.well-known/x402
- MCP (POST, stateless JSON-RPC): ${origin}/mcp

## Endpoints
${ROUTES.map((r) => `- ${r.method} ${r.path} (${r.pay}): ${r.summary}`).join("\n")}

## Paying
- Prepaid: POST /v1/keys with {"amount_usd": 5} through an x402 client, keep the forge_sk_ key, send it as a Bearer token. The x402 settlement fee (${fee} USDG) comes out of the deposit, so the key starts with the amount minus ${fee}. Calls made with the key pay no extra fee.
- Pay per call: send the request with no Authorization header, get 402 and a PAYMENT-REQUIRED header, sign the EIP-3009 authorization, resend with PAYMENT-SIGNATURE. The amount is the token ceiling plus a ${fee} USDG settlement fee (X-Forge-Settle-Fee-Usd). The unused token part is booked back to your wallet; the fee is not refunded.
- Refunds are paid out to your wallet in one transfer once your owed total reaches ${refundMin} USDG (GET /v1/wallet shows refunds_owed_usd and refund_min_usd).
- Repeated temperature-0 requests are cached per key or wallet and billed at half price (X-Forge-Cache: on|off overrides).
- Empty replies are free. Prompts are not logged.

## Errors
Errors are { "error": { "code", "message" } }. Codes: bad_request, invalid_key, payment_required, insufficient_balance, rate_limited (429), model_overloaded (429, retry), capacity_reached (503), upstream_error (502), not_configured (503), not_found.
capacity_reached means the shared daily model capacity is used up. It resets at 00:00 UTC, nothing is charged, retry after that. GET /v1/stats shows today's use under "capacity".
`;
}
