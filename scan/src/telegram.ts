// Telegram: command parsing, message text, and a minimal sendMessage client (fetch only).
import { ADDRESS } from "./scan.ts";
import type { ScanResult } from "./types.ts";

export type Command = { cmd: "start" | "help" | "scan" | "watch" | "watching" | "unwatch"; address?: string; badArg?: boolean };

const NEEDS_ADDRESS = new Set(["scan", "watch", "unwatch"]);
const KNOWN = new Set(["start", "help", "scan", "watch", "watching", "unwatch"]);

// "/scan@MyBot 0xabc..." -> { cmd: "scan", address }. A bare address means scan. Anything else is ignored (null).
export function parseCommand(text: unknown): Command | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;
  if (!t.startsWith("/")) return ADDRESS.test(t) ? { cmd: "scan", address: t.toLowerCase() } : null;
  const [head, ...rest] = t.split(/\s+/);
  const cmd = head.slice(1).split("@")[0].toLowerCase();
  if (!KNOWN.has(cmd)) return null;
  const out: Command = { cmd: cmd as Command["cmd"] };
  if (NEEDS_ADDRESS.has(cmd)) {
    if (rest[0] && ADDRESS.test(rest[0])) out.address = rest[0].toLowerCase();
    else out.badArg = true;
  }
  return out;
}

export const HELP_TEXT = [
  "Forge Scan checks Robinhood Chain tokens.",
  "",
  "/scan 0x...  risk read of one token (a bare address works too)",
  "/watch 0x...  follow a token, I message you when something changes (1 free per chat)",
  "/watching  what this chat follows",
  "/unwatch 0x...  stop following",
  "",
  "A clean score means none of the checked switches were found. It is not proof of safety.",
].join("\n");

const money = (n: number | null) => (n === null ? "unknown" : `$${Math.round(n).toLocaleString("en-US")}`);

export function formatScan(r: ScanResult): string {
  const flags = r.checks.filter((c) => c.status === "flag");
  return [
    `${r.symbol ?? "Unknown token"}${r.name ? ` (${r.name})` : ""}`,
    r.address,
    `Score ${r.score}/100, ${r.verdict}`,
    r.market ? `Liquidity ${money(r.market.liquidity_usd)}, ${r.market.txns_24h ? `${r.market.txns_24h.buys} buys / ${r.market.txns_24h.sells} sells in 24h` : "24h flow unknown"}` : "No pool data",
    ...(flags.length ? ["", "Flags:", ...flags.slice(0, 6).map((c) => `- ${c.label}`)] : []),
    "",
    r.summary,
  ].join("\n");
}

export async function sendMessage(f: typeof fetch, botToken: string, chatId: string, text: string): Promise<boolean> {
  try {
    const res = await f(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
