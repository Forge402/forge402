// Points your Telegram bot at the deployed scan worker.
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/set-telegram-webhook.mjs https://your-worker.example.com
// Run it once after you deploy and set both secrets. Add --delete to switch the webhook off. The token never leaves your machine
// except in the call to api.telegram.org.
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const base = process.argv[2];
if (!token || !secret || (!base && !process.argv.includes("--delete"))) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET, then pass the worker URL: node scripts/set-telegram-webhook.mjs https://...");
  process.exit(1);
}
const api = (m, body) => fetch(`https://api.telegram.org/bot${token}/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());
if (process.argv.includes("--delete")) console.log(await api("deleteWebhook"));
else {
  console.log(await api("setWebhook", { url: base.replace(/\/+$/, "") + "/tg/webhook", secret_token: secret, allowed_updates: ["message"] }));
  console.log(await api("getWebhookInfo"));
}
