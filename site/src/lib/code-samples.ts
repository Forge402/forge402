import { API_BASE } from '@/lib/api'

export const BASE_URL = `${API_BASE}/v1`

export const samples = [
  {
    id: 'python',
    label: 'python',
    code: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE_URL}",
    api_key="forge_sk_...",
)

reply = client.chat.completions.create(
    model="llama-3.3-70b",
    messages=[{"role": "user", "content": "Ping"}],
)
print(reply.choices[0].message.content)`,
  },
  {
    id: 'typescript',
    label: 'typescript',
    code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE_URL}",
  apiKey: "forge_sk_...",
});

const reply = await client.chat.completions.create({
  model: "llama-3.3-70b",
  messages: [{ role: "user", content: "Ping" }],
});
console.log(reply.choices[0].message.content);`,
  },
  {
    id: 'x402',
    label: 'x402 curl',
    code: `# 1. Ask without a key. The router answers 402 with the price (PAYMENT-REQUIRED header + JSON body).
curl -i ${BASE_URL}/chat/completions \\
  -H "content-type: application/json" \\
  -d '{"model":"llama-3.3-70b","messages":[{"role":"user","content":"Ping"}]}'

# 2. Sign the EIP-3009 USDG transfer it asked for, then repeat the call with the signed payload.
curl ${BASE_URL}/chat/completions \\
  -H "content-type: application/json" \\
  -H "PAYMENT-SIGNATURE: <base64 payload>" \\
  -d '{"model":"llama-3.3-70b","messages":[{"role":"user","content":"Ping"}]}'`,
  },
  {
    id: 'mcp',
    label: 'mcp',
    code: `# Stateless JSON-RPC over HTTP. Tools: list_models (free), chat (paid), scan.
curl ${API_BASE}/mcp \\
  -H "content-type: application/json" \\
  -H "Authorization: Bearer forge_sk_..." \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  },
]
