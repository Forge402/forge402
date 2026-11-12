# Forge402 router API

One Cloudflare Worker. It gives agents an OpenAI-compatible address (`/v1/chat/completions`, `/v1/embeddings`,
`/v1/models`) for open models on Cloudflare Workers AI, paid per token in USDG on Robinhood Chain. Two ways to pay:
a prepaid `forge_sk_` key, or x402 pay-per-call. The full contract is `../API.md`.

Everything is built and tested locally. Nothing is deployed. These are the steps you do once, in order.

## 1. Install

```
cd forge402/api
npm install
npm test            # 85 tests, no network
npm run typecheck
```

## 2. Create the database (D1)

```
npx wrangler d1 create forge402
```

Copy the `database_id` it prints into `wrangler.jsonc` (replace the all-zero placeholder under `d1_databases`). Then
create the tables:

```
npx wrangler d1 migrations apply forge402 --remote
```

(Use `--local` instead of `--remote` for local testing.)

## 3. Create the cache (KV)

```
npx wrangler kv namespace create CACHE
```

Paste the `id` it prints into `kv_namespaces` in `wrangler.jsonc`.

## 4. Enable Workers AI

Workers AI is on for every Cloudflare account. Check Workers AI is available in the dashboard (AI > Workers AI) and
that billing is set up, since these models are paid past the free allowance. The binding `AI` is already in
`wrangler.jsonc`.

## 5. Register the facilitator merchant

Payments are verified and settled by the Priors facilitator (`https://facilitator.priors.trade`).

1. Register the wallet that should receive money as a merchant with Priors. This is the same step you did for Reinkeep.
2. Put that public wallet address in `wrangler.jsonc` as `PAY_TO` (under `vars`).
3. Set the merchant key as a secret (step 6).

Until `PAY_TO` is filled in, paid routes answer `503 not_configured`. They never quote or charge a fake price.

## 6. Set secrets

```
npx wrangler secret put FACILITATOR_API_KEY   # Priors merchant key
npx wrangler secret put SESSION_SECRET        # any long random string; signs wallet sign-in tokens
npx wrangler secret put RPC_URL               # your Robinhood Chain RPC (used only for the $FORGE balance check)
```

Without `SESSION_SECRET`, wallet sign-in answers `503 not_configured`.

## 7. Settings you may change in `wrangler.jsonc`

| Var | Meaning |
|---|---|
| `PAY_TO` | wallet that receives payments |
| `FACILITATOR_URL` | defaults to the Priors facilitator |
| `ALLOWED_ORIGINS` | comma list of site origins for CORS (`*` for dev only) |
| `FORGE_TOKEN` | $FORGE contract address. Leave empty until the token launches: no discount, no holder playground |
| `HOLDER_MIN` | balance that counts as a holder, in the token's smallest units (default is 1,000,000 tokens at 18 decimals) |
| `HOLDER_DISCOUNT_PCT` | percent off for holders |
| `AI_DAILY_NEURONS` / `FREE_DAILY_NEURONS` | daily Workers AI neuron budget, see Free plan limits |

To let the MCP `scan` tool work, deploy `forge402/scan` first, then uncomment the `services` block (binding `SCAN`).

## Free plan limits

The Workers Free plan never bills, it just refuses once a limit is hit. The worker stays under them on purpose.

| Limit | Free plan | What the worker does |
|---|---|---|
| Workers AI | 10,000 neurons a day for the whole account, reset 00:00 UTC | `AI_DAILY_NEURONS` (default `7500`) caps this worker, so the other product and the scan worker keep room. `FREE_DAILY_NEURONS` (default `2000`) is the playground share. At the cap: chat and embeddings answer `503 capacity_reached`, the playground answers `429 rate_limited` once its share is gone, and nobody is charged. |
| KV writes | 1,000 a day | Response-cache writes stop at 900 a day (reads still work). |
| Paid-only models | 8 models (kimi, glm-5.x, deepseek-v4) answer Cloudflare error 5035 on Free | Flagged `paidPlan` in the catalog: hidden from `/v1/models` and refused with `404 model_not_found` before any payment. The site hides them too. |

Set `AI_DAILY_NEURONS` to `"0"` for no cap, only after moving to a paid plan. That same `"0"` also unlocks the 8 paid-only models; set `VITE_CF_PAID_PLAN=1` on the site build at the same time. The budget is soft: calls already running when the cap is crossed still finish. Today's use is in `GET /v1/stats` under `capacity`.

## 8. Check, then deploy (only when you decide)

```
npx wrangler deploy --dry-run     # builds and lists bindings, deploys nothing
npx wrangler deploy               # the real deploy
```

## Running locally

```
npm run dev     # http://localhost:8787
```

Local mode uses a local SQLite for D1 and KV. Apply the migration with `--local` first. Workers AI has no local
simulator: calls to `env.AI` need `wrangler dev --remote`, which uses your Cloudflare login. Without it, chat calls
that reach the model return a 502 `upstream_error` (nothing is billed).

## How money moves

- Amounts are whole micro-USD (6 decimals, the same as USDG units).
- Prepaid key: the call's ceiling (estimated input plus `max_tokens` at the posted price) is taken from the balance
  first with one conditional database update, so parallel calls can never overspend. After the answer, the unused part
  goes back.
- x402: the signed amount is the token ceiling plus the settle fee (`SETTLE_FEE_USD`, default 0.015: what the Priors
  facilitator charges us per settled payment; header `X-Forge-Settle-Fee-Usd`). The fee is kept, never refunded. Key
  calls do no settle, so they pay no fee. Deposits and top-ups sign the full amount and the key is credited amount
  minus the fee (`fee_usd` in the response); an amount at or below the fee is refused. The facilitator verifies, the model runs, then the payment settles. If the
  model fails or the reply is empty, nothing settles. The ceiling minus the real cost is written to the `refunds` table
  as owed to the payer wallet.
- Closing a key writes its remaining balance to `refunds` for the owner wallet.
- If a settlement is still `settlement_pending` after the retries, the result is withheld, the nonce is kept, and the
  whole signed amount is written to `refunds` with reason `pending_settle` (not counted in `refunds_owed_usd`). Check
  the nonce on chain: if the transfer landed, set the row's reason to `change` so it is owed back; if it never landed,
  delete the row. List them with
  `npx wrangler d1 execute forge402 --remote --command "SELECT * FROM refunds WHERE reason='pending_settle'"`.
- A discounted charge never drops below the Cloudflare cost (break-even floor); a cache hit runs no model, so it has no floor.
- Refunds under `REFUND_MIN_USD` (default 0.05) are not worth the gas of a transfer: they stay owed and add up per
  wallet. `GET /v1/wallet` shows `refunds_owed_usd` (total) and `refund_min_usd`.
- Refunds are only a ledger. Sending the USDG back is a manual step for now: read what is owed with
  `npx wrangler d1 execute forge402 --remote --command "SELECT wallet, SUM(amount_micro) FROM refunds WHERE paid=0 GROUP BY wallet"`
  and mark rows `paid=1` after you send it.
- The ledger never stores prompts or replies, only model, token counts, charge and time.
- Streaming responses carry the real charge in the final `usage` chunk (`usage.cost_usd`). Under x402, a streamed
  call settles after the stream ends, so the `PAYMENT-RESPONSE` header is not sent for streams.
