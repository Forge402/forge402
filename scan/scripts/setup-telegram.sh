#!/usr/bin/env bash
# One-time Telegram setup for Forge Watch. Run from forge402/scan:  bash scripts/setup-telegram.sh
# Asks for the BotFather token (hidden), makes a random webhook secret, stores both as Worker secrets and points the
# bot at the deployed worker. The token is only sent to Cloudflare (wrangler) and api.telegram.org.
set -euo pipefail
URL="${1:-https://scan.forge402.pro}"

read -r -s -p "Paste the bot token from BotFather, then Enter: " TOKEN; echo
[[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]] || { echo "That does not look like a BotFather token (digits:letters). Nothing was changed."; exit 1; }
SECRET="$(openssl rand -hex 32)"

printf '%s' "$TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN >/dev/null && echo "Saved TELEGRAM_BOT_TOKEN"
printf '%s' "$SECRET" | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET >/dev/null && echo "Saved TELEGRAM_WEBHOOK_SECRET"

# curl, not node: api.telegram.org can take 5-10 s to connect from some networks and node's fetch gives up at 10 s.
TG() { curl -sS --retry 3 --retry-all-errors --connect-timeout 30 -m 60 "https://api.telegram.org/bot${TOKEN}/$1" -H 'content-type: application/json' -d "${2:-{\}}"; echo; }
echo "Connecting the bot to ${URL}/tg/webhook ..."
TG setWebhook "{\"url\":\"${URL%/}/tg/webhook\",\"secret_token\":\"${SECRET}\",\"allowed_updates\":[\"message\"]}"
TG getWebhookInfo | grep -oE '"url":"[^"]*"|"pending_update_count":[0-9]+|"last_error_message":"[^"]*"' || true
echo "Bot username:"; TG getMe | grep -o '"username":"[^"]*"'
unset TOKEN SECRET
