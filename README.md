<p align="center">
  <img src="site/public/assets/forge-coin-front.png" width="140" alt="$FORGE coin">
</p>

<h1 align="center">Forge402</h1>

<p align="center"><b>One endpoint for every open model on Robinhood Chain.</b></p>

<p align="center">
  <a href="https://forge402.pro">Website</a> ·
  <a href="https://forge402.pro/docs">Docs</a> ·
  <a href="https://forge402.pro/scan">Forge Scan</a> ·
  <a href="https://x.com/forge402">X</a>
</p>

---

Forge402 gives agents an OpenAI-compatible address for open models on Cloudflare Workers AI, paid per token in
**USDG on Robinhood Chain**.

- **Drop-in API**: `/v1/chat/completions`, `/v1/embeddings` and `/v1/models`. Point any OpenAI SDK at `https://api.forge402.pro`.
- **Two ways to pay**: a prepaid `forge_sk_` key, or **x402** pay-per-call with no account at all.
- **Pay for what you use**: the unused part of every call's ceiling goes back to you.
- **No prompt logging**: the ledger keeps the model, token counts and price, never the text.
- **Forge Scan**: token risk reads for Robinhood Chain, plus Launch Radar and Forge Watch on Telegram.
- **$FORGE**: hold it in the wallet that pays and every call costs less. Calls are still paid in USDG.

```bash
curl https://api.forge402.pro/v1/chat/completions \
  -H "Authorization: Bearer forge_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"granite-4.0-micro","messages":[{"role":"user","content":"hello"}]}'
```

<sub>The only official $FORGE contract address is the one posted on forge402.pro and by @forge402 on X.</sub>
