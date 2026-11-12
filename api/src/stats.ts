import type { Env } from "./env.ts";
import { capacityNow } from "./capacity.ts";
import { utcDay } from "./accounts.ts";
import type { Repo } from "./repo.ts";

const DAY = 86_400_000;
export const RANGES: Record<string, number | null> = { "7d": 7 * DAY, "30d": 30 * DAY, "90d": 90 * DAY, all: null };

// Scans live in the scan worker's database (web, Telegram, radar and paid). The ledger here only sees paid MCP scans,
// so the scan worker's count is the real one; the ledger count is the fallback when the binding is missing or fails.
async function scanCount(env: Env, since: number): Promise<number | null> {
  if (!env.SCAN) return null;
  try {
    const res = await env.SCAN.fetch(new Request(`https://scan.internal/v1/scan/count?since=${since}`));
    const n = res.ok ? ((await res.json()) as { count?: unknown }).count : null;
    return typeof n === "number" && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

// GET /v1/stats. Straight sums over the ledger: nothing seeded, so an empty ledger gives zeros.
export async function statsFor(repo: Repo, range: string, now: number, env: Env = {}) {
  const span = RANGES[range];
  const since = span === null ? 0 : now - span;
  const [{ totals, per_model, daily }, scans] = await Promise.all([repo.stats(since), scanCount(env, since)]);
  return {
    range,
    tokens_in: totals.tokens_in,
    tokens_out: totals.tokens_out,
    calls: totals.calls,
    scans: scans ?? totals.scans,
    volume_usd: Math.round(totals.volume_usd * 1e6) / 1e6,
    // hits / (hits + misses): calls that bypassed the cache are not counted either way.
    cache_hit_rate: totals.cacheable ? Math.round((totals.hits / totals.cacheable) * 1e4) / 1e4 : 0,
    per_model,
    daily,
    capacity: await capacityNow(repo, env, utcDay(now)),
  };
}
