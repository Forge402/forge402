# Forge402 scan worker

One Cloudflare Worker with three products: Forge Scan (token risk read), Launch Radar (hourly track record of young pools),
Forge Watch (Telegram bot that follows a token). Routes are in `../API.md`, section "scan worker routes".

Status: built and tested, **not deployed**. Nothing below has been run against your Cloudflare account.

## What it does

- `GET /v1/scan/:address` free, 30 per caller per hour. `POST /v1/scan {"address"}` paid with x402, default $0.02 (20000 atomic USDG), set by `SCAN_PRICE_USD`; answers 503 not_configured if below `SETTLE_FEE_USD` (0.015, the Priors fee per settlement) + 0.002.
- `GET /v1/scan/rules` the published scoring table. `GET /v1/scan/recent` last 12 scans. `GET /v1/radar` the real track record.
- `POST /tg/webhook` Telegram. Commands: /start /help /scan /watch /watching /unwatch. One free watch per chat.
- Reads the chain through your `RPC_URL` (batched JSON-RPC: code, EIP-1967 slot, owner(), supply, symbol, owner balance), pool data from DexScreener
  (GeckoTerminal as fallback), and writes a 3-sentence summary with Workers AI (`@cf/meta/llama-3.2-3b-instruct`), with a rule-written fallback.
- Honest limits: it looks for common function selectors in bytecode. An oddly named mint function is not seen. A clean score is not proof of safety.
  Holder spread beyond "what the owner holds" is not read (needs Transfer logs, which the public node refuses from Cloudflare).

Radar outcomes: ~24h after first sight the liquidity is read again. `drained` = 10% or less left or under $500, `up` = 25%+ more,
`down` = 25%+ less, otherwise `held`. Tokens the radar has not rechecked yet show as `pending`. No row is ever invented: an empty
database returns zeros.

## Set it up (you, once)

1. `cd forge402/scan && npm install`
2. Create the database: `npx wrangler d1 create forge402-scan`. Copy the `database_id` it prints into `wrangler.jsonc` (replace the zeros).
3. Create the tables: `npx wrangler d1 migrations apply forge402-scan --remote`
4. Secrets (each command asks you to paste the value):
   - `npx wrangler secret put RPC_URL` your Chainstack URL
   - `npx wrangler secret put TELEGRAM_BOT_TOKEN` (see BotFather below)
   - `npx wrangler secret put TELEGRAM_WEBHOOK_SECRET` any long random string, e.g. `openssl rand -hex 32`
   - `npx wrangler secret put FACILITATOR_API_KEY` only if your facilitator wants one, otherwise skip
5. In `wrangler.jsonc` set `PAY_TO` to the wallet that should receive USDG (empty means paid scans answer 503 `not_configured`) and put the
   real site address in `ALLOWED_ORIGINS`.
6. Deploy when you are ready: `npx wrangler deploy`. Cron jobs (hourly radar, 5-minute watch) start by themselves.
7. Point Telegram at the worker (after the secrets exist):
   `TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/set-telegram-webhook.mjs https://<your-worker-url>`

Without `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` the Telegram route answers 503 `not_configured` and the 5-minute job does nothing.

### BotFather (making the bot)

1. In Telegram open a chat with `@BotFather` and send `/newbot`.
2. Give it a display name, then a username that ends in `bot`.
3. BotFather replies with a token like `123456:ABC...`. That is `TELEGRAM_BOT_TOKEN`. Keep it private.
4. Optional: `/setcommands`, pick your bot, paste:
   ```
   scan - risk read of a token
   watch - follow a token
   watching - what this chat follows
   unwatch - stop following a token
   help - how it works
   ```
5. Optional: `/setprivacy` then Disable, if you want the bot to see `/scan` in groups without being mentioned.

## Free plan limits

Built to run on the Workers Free plan without paying; limits are bounded in code, not by hope.

- **Workers AI**: 10,000 neurons/day per account, shared with other workers. `SCAN_AI_DAILY_NEURONS` (default 1000, `0` = no cap) is this worker's slice,
  counted per UTC day in D1 (migration `0002`). Over it, summaries are the rule-written fallback and scans still succeed. Roughly 4 neurons per summary.
  The check is read-then-call, so a burst of simultaneous scans can overshoot the slice by a few summaries.
- **Subrequests**: 50 per invocation, and D1 calls count. Radar scans at most 2 new pools per run (worst case 43, 46 with a CoinGecko key), Watch re-reads at most 4 tokens per
  5-minute run, oldest checked first (worst case 41, 45 with a CoinGecko key). One scan is at most about 13.
- Cron triggers: 2 used of 5. CPU 10 ms: untested on the real runtime, check the first deploy's logs.

## Local work

- `npm test` unit tests (vitest), `npm run typecheck`, `npx wrangler deploy --dry-run --outdir .dryrun`
- `npx wrangler d1 migrations apply forge402-scan --local` then `npm run dev` serves on http://localhost:8788
- `node scripts/smoke.ts 0xTOKEN` runs the real scan from your machine (public RPC, DexScreener), prints the JSON
- Local secrets go in `.dev.vars` (git-ignored), e.g. `RPC_URL=...`

## Notes for later

- Cloudflare free plan allows 50 outgoing requests per run. A watch run reads at most 10 tokens (about 3 requests each), radar scans at most
  4 new tokens an hour. Raise those numbers in `src/watch.ts` and `src/radar.ts` only on a paid plan.
- DexScreener chain slug for Robinhood Chain is `robinhood` (checked with a real request on 2026-11-12).
- Free-tier counter keys on a hashed caller IP in D1, so no raw IPs are stored.

- **CoinGecko budget**: `COINGECKO_DAILY_CALLS` (default 300, `0` = no cap) limits CoinGecko requests per UTC day, counted in D1 (`cg_usage`, migration 0003), failures included. Radar and Watch get at most a third each; scans get whatever is left. Over budget, that call goes to DexScreener.
