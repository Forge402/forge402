// Launch Radar: every hour, find young pools with real liquidity, scan each token once on first sight, and ~24h later
// read its liquidity again. The outcomes are the track record; nothing here is seeded.
import { discoverYoungPools, readMarketsBatch, type MarketDeps } from "./market.ts";
import { scanToken, type ScanDeps } from "./scan.ts";
import type { Store } from "./store.ts";

export const RADAR = { maxAgeH: 72, minLiquidityUsd: 10_000, newPerRun: 2, recheckAfterMs: 23 * 3_600_000, recheckPerRun: 20 } as const;
// ponytail: Free plan allows 50 subrequests per invocation (fetch, RPC, AI and D1 calls all count). Worst case per run:
// discovery 11 + radarSeen 1 + newPerRun x 13 (one scan with retries, AI, D1) + radarDue 1 + market batch 2 + outcomes batch 1 + prune 1.
// With a CoinGecko key the call budget adds one D1 write per CoinGecko request: discovery +1, each scan +1. newPerRun 2 = 43 without a key, 46 with one,
// under the 50 limit (the 45 safety margin is spent; do not raise newPerRun). The rest wait for the next hour (found pools not yet in `radar` are picked up again).
// Raise newPerRun only on the paid plan (1000 subrequests).
export type Outcome = "held" | "up" | "down" | "drained";

// drained: 10% or less of the first liquidity left, or under $500. up / down: 25% or more above / below. Else held.
// now === null means "could not read": no verdict yet.
export function classifyOutcome(first: number | null, now: number | null): Outcome | null {
  if (now === null) return null;
  if (now < 500) return "drained";
  if (first === null || first <= 0) return "held";
  if (now <= first * 0.1) return "drained";
  if (now >= first * 1.25) return "up";
  if (now <= first * 0.75) return "down";
  return "held";
}

export async function runRadar(store: Store, scanDeps: ScanDeps, mk: MarketDeps): Promise<{ scanned: number; rechecked: number; candidates: number; skipped?: "discovery_unavailable" }> {
  const now = mk.now();
  const found = await discoverYoungPools(mk, { maxAgeH: RADAR.maxAgeH, minLiq: RADAR.minLiquidityUsd });
  if (found === null) {
    console.log(JSON.stringify({ event: "radar_skipped", reason: "discovery_unavailable" }));
    return { scanned: 0, rechecked: 0, candidates: 0, skipped: "discovery_unavailable" };
  }
  const seen = await store.radarSeen(found.map((c) => c.token));
  const fresh = found.filter((c) => !seen.has(c.token)).slice(0, RADAR.newPerRun);
  let scanned = 0;
  for (const c of fresh) {
    try {
      const d = await scanToken(c.token, scanDeps);
      await store.saveScan(d.result, d.tickerNorm, "radar", now);
      await store.radarInsert({ address: c.token, symbol: d.result.symbol, name: d.result.name, flags: d.result.checks.filter((x) => x.status === "flag").map((x) => x.label), poolAgeHours: d.market?.pool_age_hours ?? c.market.pool_age_hours, firstSeenMs: now, score: d.result.score, verdict: d.result.verdict, liquidity: d.market?.liquidity_usd ?? c.market.liquidity_usd });
      scanned++;
    } catch (e) {
      console.log(JSON.stringify({ event: "radar_scan_failed", token: c.token, error: String(e) }));
    }
  }

  const due = await store.radarDue(now - RADAR.recheckAfterMs, RADAR.recheckPerRun);
  let rechecked = 0;
  if (due.length) {
    const markets = await readMarketsBatch(due.map((r) => r.address), mk);
    if (markets) {
      const done: { address: string; liquidityNow: number | null; outcome: string }[] = [];
      for (const r of due) {
        const m = markets.get(r.address);
        // No pool any more counts as drained; a pool that reports no liquidity is left for the next run.
        const liq = m === null || m === undefined ? 0 : m.liquidity_usd;
        const outcome = classifyOutcome(r.liquidity_first, liq);
        if (outcome) done.push({ address: r.address, liquidityNow: liq, outcome });
      }
      await store.radarSetOutcomes(done, now);
      rechecked = done.length;
    }
  }
  return { scanned, rechecked, candidates: found.length };
}
