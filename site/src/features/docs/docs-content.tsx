import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { BASE_URL } from '@/lib/code-samples'
import { CodeTabs } from '@/components/code-tabs'

const ORIGIN = BASE_URL.replace(/\/v1$/, '')

export function Code({ children, label }: { children: string; label?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0A0807]">
      <div className="flex items-center justify-between border-b border-white/10 px-4">
        <span className="label py-2.5">{label ?? 'code'}</span>
        <button onClick={async () => { try { await navigator.clipboard.writeText(children); setOk(true); setTimeout(() => setOk(false), 1500) } catch { /* blocked */ } }} className="label flex cursor-pointer items-center gap-1.5 hover:!text-white" aria-label="Copy code">
          {ok ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}{ok ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre tabIndex={0} className="m-0 overflow-x-auto p-4 font-mono text-[13px] leading-6 text-white/85"><code>{children}</code></pre>
    </div>
  )
}

const Ic = ({ children }: { children: ReactNode }) => <code className="rounded bg-[#F1F3F5] px-1.5 py-0.5 font-mono text-[0.88em] text-ink">{children}</code>

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="panel my-4 overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-[14px]">
        <thead><tr className="border-b border-line">{head.map((h) => <th key={h} scope="col" className="label px-4 py-2.5 text-left font-normal">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line align-top last:border-0">{r.map((c, j) => <td key={j} className="px-4 py-2.5 text-ink">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

export const sections: { id: string; title: string; body: ReactNode }[] = [
  {
    id: 'quickstart', title: 'Quickstart',
    body: (
      <>
        <p>Forge402 speaks the OpenAI API. Point any OpenAI SDK at <Ic>{BASE_URL}</Ic>, use a prepaid <Ic>forge_sk_</Ic> key and pick a model id from the <a className="underline" href="/models">catalog</a>.</p>
        <CodeTabs />
        <p>Streaming works the usual way with a prepaid key (<Ic>stream: true</Ic>, SSE chunks, final usage chunk). Pay-per-call (x402) answers come whole, after the payment settles. Every response carries <Ic>X-Forge-Cost-Usd</Ic>, <Ic>X-Forge-Cache</Ic> (HIT, MISS or BYPASS), <Ic>X-Forge-Discount-Pct</Ic> and <Ic>X-Forge-Model</Ic>.</p>
        <Table head={['Route', 'What it does']} rows={[
          [<Ic key="a">GET /v1/models</Ic>, 'Model list with prices per 1M tokens, context length, type.'],
          [<Ic key="b">POST /v1/chat/completions</Ic>, 'Chat, OpenAI shape, streaming with a key.'],
          [<Ic key="c">POST /v1/embeddings</Ic>, 'Embeddings, OpenAI shape, exact cost.'],
        ]} />
      </>
    ),
  },
  {
    id: 'x402', title: 'Pay per call with x402',
    body: (
      <>
        <p>No account needed. Call a paid route without an <Ic>Authorization</Ic> header and you get <Ic>402</Ic> with a <Ic>PAYMENT-REQUIRED</Ic> header (base64 JSON, same JSON in the body).</p>
        <Code label="402 body">{`{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:4663",
    "asset": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    "amount": "1500",
    "payTo": "0x…",
    "maxTimeoutSeconds": 300,
    "extra": { "name": "Global Dollar", "version": "1" }
  }],
  "resource": "…",
  "description": "…"
}`}</Code>
        <p>Sign an EIP-3009 <Ic>TransferWithAuthorization</Ic> for that amount (domain: <Ic>extra.name</Ic>, <Ic>extra.version</Ic>, chainId 4663, verifyingContract = <Ic>asset</Ic>), wrap it as a base64 x402 payload and resend the same request with it in <Ic>PAYMENT-SIGNATURE</Ic>. The router verifies through the facilitator, runs the work, then settles. If the work fails, nothing is settled. Amounts are USDG with 6 decimals.</p>
        <Code label="payload before base64">{`{
  "x402Version": 2,
  "accepted": { …the accepts[0] entry, unchanged },
  "payload": {
    "signature": "0x…",
    "authorization": { "from", "to", "value", "validAfter", "validBefore", "nonce" }
  }
}`}</Code>
        <p>Reusing an authorization nonce returns <Ic>409 payment_replayed</Ic>. A chat call is priced at a ceiling (input estimate plus <Ic>max_tokens</Ic>, default 1024). If the real cost is lower, the difference is booked as a refund owed to your wallet.</p>
        <p>Every x402 call also carries a flat <strong>$0.015 settlement fee</strong>: the on-chain facilitator charges it for each payment it settles, and it is included in the 402 price (header <Ic>X-Forge-Settle-Fee-Usd</Ic>). Many small calls are cheaper with a prepaid key, which pays that fee once per deposit.</p>
      </>
    ),
  },
  {
    id: 'keys', title: 'Prepaid keys',
    body: (
      <>
        <p>A key holds a USDG balance and is billed at the exact cost per call, with no per-call settlement fee. Each deposit or top-up is one x402 payment, so its $0.015 settlement fee comes off the amount credited. The key is shown once at creation and stored only as a hash. You can also do all of this in the <a className="underline" href="/dashboard">console</a>.</p>
        <Table head={['Route', 'Notes']} rows={[
          [<Ic key="a">POST /v1/keys</Ic>, <>Body <Ic>{`{ "amount_usd": 1..1000, "label"? }`}</Ic>, paid by x402. Returns <Ic>{`{ key, balance_usd, owner }`}</Ic>.</>],
          [<Ic key="b">POST /v1/keys/topup</Ic>, 'x402 payment plus Bearer key. Returns the new balance.'],
          [<Ic key="c">GET /v1/keys/me</Ic>, 'Bearer key. Owner, label, balance, spent, calls, recent calls.'],
          [<Ic key="d">DELETE /v1/keys/me</Ic>, 'Revokes the key. The remaining balance becomes a refund owed to the owner.'],
        ]} />
        <h3 className="mb-2 mt-6 text-[18px] font-semibold text-ink">Wallet sign-in</h3>
        <Code label="flow">{`POST ${ORIGIN}/v1/auth/nonce   { "address": "0x…" }                  -> { message, nonce }
# sign "message" with personal_sign
POST ${ORIGIN}/v1/auth/verify  { "address", "signature", "nonce" }   -> { token }   # 24h session
GET  ${ORIGIN}/v1/wallet       Authorization: Bearer <token>
  -> { address, keys[], refunds_owed_usd, discount_pct, free_messages_left }
POST ${ORIGIN}/v1/wallet/keys/:id/close   Authorization: Bearer <token>`}</Code>
      </>
    ),
  },
  {
    id: 'caching', title: 'Caching and refunds',
    body: (
      <>
        <p>Requests at <Ic>temperature: 0</Ic> are cached for 24 hours, scoped to your key or wallet. A cache hit is billed at 50%. Send <Ic>X-Forge-Cache: on</Ic> or <Ic>off</Ic> to override. If the cache is unavailable, the call goes through uncached. An empty model reply is not charged.</p>
        <p>Refunds come from two places: unused ceiling on x402 chat calls, and the balance of a closed key. Both show up as <Ic>refunds_owed_usd</Ic> in your wallet view. Refunds add up per wallet and are paid out in USDG once the total reaches $0.05, since each payout is an on-chain transfer.</p>
      </>
    ),
  },
  {
    id: 'discount', title: 'Holder discount',
    body: <p>When the $FORGE token is live, wallets holding at least the minimum amount get a percentage off every call. The router reads your balance on chain and caches it for 10 minutes. The current value is returned in <Ic>X-Forge-Discount-Pct</Ic> and in your wallet view. Until the token launches the discount is 0%.</p>,
  },
  {
    id: 'scan', title: 'Forge Scan',
    body: (
      <>
        <p>Reads a Robinhood Chain token contract and scores it from 0 to 100 by published rules. Free on the web (30 per hour per visitor). Agents pay $0.02 per call with x402.</p>
        <Code label="curl">{`# free, web
curl ${ORIGIN}/v1/scan/0x…

# paid, x402 (same 402 flow as above)
curl -X POST ${ORIGIN}/v1/scan -H "content-type: application/json" -d '{"address":"0x…"}'

curl ${ORIGIN}/v1/scan/recent   # last 12 scans
curl ${ORIGIN}/v1/scan/rules    # scoring rules
curl ${ORIGIN}/v1/radar         # launch radar record`}</Code>
        <p>The response has <Ic>score</Ic>, <Ic>verdict</Ic> (clean, caution, risky), a <Ic>checks</Ic> list where each check is <Ic>pass</Ic>, <Ic>flag</Ic> or <Ic>unknown</Ic>, a <Ic>market</Ic> block, a short <Ic>summary</Ic>, <Ic>scanned_at</Ic> and <Ic>rules_version</Ic>. Unknown means the data could not be read, not that it is fine.</p>
      </>
    ),
  },
  {
    id: 'watch', title: 'Forge Watch',
    body: <p>A Telegram bot that watches tokens and pings you on changes. See <a className="underline" href="/watch">the Watch page</a> for commands and limits.</p>,
  },
  {
    id: 'mcp', title: 'MCP',
    body: (
      <>
        <p><Ic>POST {ORIGIN}/mcp</Ic> is a stateless JSON-RPC MCP endpoint. Tools: <Ic>list_models</Ic> (free), <Ic>chat</Ic> (paid, pass your key in the header) and <Ic>scan</Ic>. Discovery files: <Ic>/openapi.json</Ic>, <Ic>/.well-known/x402</Ic> and <Ic>/llms.txt</Ic>.</p>
        <Code label="call a tool">{`curl ${ORIGIN}/mcp -H "content-type: application/json" -H "Authorization: Bearer forge_sk_..." \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_models","arguments":{}}}'`}</Code>
      </>
    ),
  },
  {
    id: 'errors', title: 'Errors',
    body: (
      <>
        <p>Every error has the same shape: <Ic>{`{ "error": { "code": "snake_case", "message": "plain words" } }`}</Ic> plus the HTTP status.</p>
        <Table head={['Code', 'HTTP', 'Meaning']} rows={[
          ['payment_required', '402', 'No key or payment. Read the PAYMENT-REQUIRED header.'],
          ['terms_mismatch', '402', 'The signed payment does not match the offer.'],
          ['verify_invalid', '402', 'The facilitator rejected the signature.'],
          ['payment_replayed', '409', 'That authorization nonce was already used.'],
          ['invalid_key', '401', 'Unknown, revoked or malformed key or session.'],
          ['insufficient_balance', '402', 'The key balance is below the call ceiling.'],
          ['rate_limited', '429', 'Free limit reached. Slow down or use a key.'],
          ['model_not_found', '404', 'Unknown model id.'],
          ['model_overloaded', '429', 'The model is busy. Retry shortly.'],
          ['bad_request', '400', 'Malformed body or parameters.'],
          ['upstream_error', '502', 'The model or a dependency failed. Nothing was charged.'],
          ['not_configured', '503', 'The feature is not set up yet. Nothing was charged.'],
        ].map((r) => r.map((c, i) => (i === 0 ? <Ic key={c}>{c}</Ic> : c)))} />
      </>
    ),
  },
]
