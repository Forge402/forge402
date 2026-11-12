// Forge Watch: the chat commands, and the 5-minute re-read that messages only when something meaningful changed.
import { scanToken, type ScanDeps, type ScanDetail } from "./scan.ts";
import type { Store, WatchState } from "./store.ts";
import { formatScan, HELP_TEXT, parseCommand, sendMessage } from "./telegram.ts";

// ponytail: 50 subrequests per invocation on the Free plan. One token re-read costs at most 10 (RPC 2 batches x2 tries, market 3,
// ticker 1, watch upsert 1, Telegram 1, rounded up for the scan's AI-free path) + 1 for the oldest-checked query:
// perRun 4 = 41 without a CoinGecko key. With one, each re-read adds 1 D1 write for the call budget: 45, under the 50 limit. watchOldestChecked orders by last_checked_ms, so the rest rotate in over later runs.
export const WATCH = { freePerChat: 1, perRun: 4, liquidityDropPct: 30, scoreDropPoints: 10, mintedPct: 1 } as const;

export function stateOf(d: ScanDetail): WatchState {
  return { owner: d.facts.owner, impl: d.facts.implSlot ?? d.facts.cloneTarget, liquidity_usd: d.market?.liquidity_usd ?? null, score: d.result.score, supply: d.facts.totalSupply };
}

// Compares the previous reading with the new one. Returns plain-sentence alerts; an empty list means stay quiet.
// ponytail: compares only with the LAST reading, so a slow bleed of 20% per check never alerts. Add a peak baseline if it matters.
export function detectChanges(prev: WatchState, now: WatchState): string[] {
  const out: string[] = [];
  if (prev.owner !== null && now.owner !== null && prev.owner !== now.owner) {
    const zero = /^0x0{40}$/;
    out.push(zero.test(now.owner) ? "The owner renounced ownership." : zero.test(prev.owner) ? `Ownership came back: owner is now ${now.owner}.` : `The owner changed from ${prev.owner} to ${now.owner}.`);
  }
  if (prev.impl !== now.impl) out.push(now.impl ? `The proxy implementation changed to ${now.impl}.` : "The proxy implementation was removed.");
  if (prev.liquidity_usd !== null && prev.liquidity_usd > 0 && now.liquidity_usd !== null && now.liquidity_usd <= prev.liquidity_usd * (1 - WATCH.liquidityDropPct / 100)) {
    const pct = Math.round((1 - now.liquidity_usd / prev.liquidity_usd) * 100);
    out.push(`Liquidity fell ${pct}% since the last check ($${Math.round(prev.liquidity_usd).toLocaleString("en-US")} to $${Math.round(now.liquidity_usd).toLocaleString("en-US")}).`);
  }
  if (now.score <= prev.score - WATCH.scoreDropPoints) out.push(`The score dropped from ${prev.score} to ${now.score}.`);
  if (prev.supply !== null && now.supply !== null) {
    const a = BigInt(prev.supply), b = BigInt(now.supply);
    if (a > 0n && b * 100n >= a * BigInt(100 + WATCH.mintedPct)) out.push(`Total supply grew ${Number(((b - a) * 10000n) / a) / 100}%: new tokens were minted.`);
  }
  return out;
}

export type BotDeps = { store: Store; scan: ScanDeps; fetch: typeof fetch; botToken: string; now: () => number };

// Runs one chat message and returns the reply text (null = ignore the message).
export async function handleMessage(chatId: string, text: unknown, d: BotDeps): Promise<string | null> {
  const c = parseCommand(text);
  if (!c) return null;
  if (c.cmd === "start" || c.cmd === "help") return HELP_TEXT;
  if (c.cmd === "watching") {
    const rows = await d.store.watchList(chatId);
    return rows.length ? ["Following:", ...rows.map((r) => `- ${r.symbol ?? "token"} ${r.address} (score ${r.state.score})`)].join("\n") : "This chat follows nothing yet. Send /watch 0x... to start.";
  }
  if (c.badArg || !c.address) return `Send it like this: /${c.cmd} 0x followed by the 40-character token address.`;
  if (c.cmd === "unwatch") return (await d.store.watchRemove(chatId, c.address)) ? "Stopped following that token." : "This chat was not following that token.";

  if (c.cmd === "watch" && !(await d.store.watchHas(chatId, c.address)) && (await d.store.watchCount(chatId)) >= WATCH.freePerChat) {
    return `Free chats follow ${WATCH.freePerChat} token. Send /unwatch with the current one first.`;
  }
  let detail: ScanDetail;
  try {
    detail = await scanToken(c.address, d.scan);
  } catch {
    return "Could not read that token from the chain right now. Try again in a minute.";
  }
  const now = d.now();
  await d.store.saveScan(detail.result, detail.tickerNorm, "telegram", now).catch(() => {});
  if (c.cmd === "scan") return formatScan(detail.result);
  if (!detail.facts.isContract) return "No contract at that address on Robinhood Chain, so there is nothing to follow.";
  await d.store.watchUpsert(chatId, c.address, detail.result.symbol, stateOf(detail), now);
  return `Following ${detail.result.symbol ?? "this token"}. I read it about every 5 minutes and write only when the owner, the proxy implementation, the liquidity (down ${WATCH.liquidityDropPct}% or more), the supply or the score (down ${WATCH.scoreDropPoints}+ points) changes.\n\nNow: score ${detail.result.score}/100, ${detail.result.verdict}.`;
}

// Cron: re-read the least recently checked tokens, message the chats whose reading changed meaningfully.
export async function runWatchCron(d: BotDeps): Promise<{ checked: number; alerts: number }> {
  const rows = await d.store.watchOldestChecked(WATCH.perRun);
  const cache = new Map<string, ScanDetail | null>();
  let alerts = 0;
  for (const row of rows) {
    if (!cache.has(row.address)) {
      cache.set(row.address, await scanToken(row.address, d.scan, { summary: false }).catch(() => null));
    }
    const detail = cache.get(row.address);
    const now = d.now();
    if (!detail) { await d.store.watchTouch(row.chat_id, row.address, now); continue; }
    const next = stateOf(detail);
    if (detail.marketStatus === "unavailable") next.liquidity_usd = row.state.liquidity_usd; // unreachable is not "liquidity gone"
    const changes = detectChanges(row.state, next);
    if (changes.length) {
      const text = [`${detail.result.symbol ?? "A token you follow"} changed:`, ...changes.map((x) => `- ${x}`), "", detail.result.address, `Score now ${next.score}/100, ${detail.result.verdict}.`].join("\n");
      if (await sendMessage(d.fetch, d.botToken, row.chat_id, text)) alerts++;
    }
    await d.store.watchUpsert(row.chat_id, row.address, detail.result.symbol, next, now);
  }
  return { checked: rows.length, alerts };
}
