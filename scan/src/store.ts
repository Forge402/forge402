// All D1 access. Parameterized statements only.
import type { ScanResult } from "./types.ts";

export type WatchState = { owner: string | null; impl: string | null; liquidity_usd: number | null; score: number; supply: string | null };
export type WatchRow = { chat_id: string; address: string; symbol: string | null; created_ms: number; last_checked_ms: number; state: WatchState };
export type RadarRow = { address: string; symbol: string | null; name: string | null; flags_json: string; pool_age_hours: number | null; first_seen_ms: number; score: number; verdict: string; liquidity_first: number | null; liquidity_now: number | null; recheck_ms: number | null; outcome: string | null };

export type CgCaller = "scan" | "radar" | "watch";
const DAY = 86_400_000;

export class Store {
  constructor(private db: D1Database) {}

  async saveScan(r: ScanResult, tickerNorm: string | null, source: "web" | "paid" | "radar" | "telegram", nowMs: number): Promise<void> {
    await this.db.prepare("INSERT INTO scans (address, ticker_norm, score, verdict, source, scanned_ms, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(r.address, tickerNorm, r.score, r.verdict, source, nowMs, JSON.stringify(r)).run();
  }

  async countScans(sinceMs: number): Promise<number> {
    return (await this.db.prepare("SELECT COUNT(*) AS n FROM scans WHERE scanned_ms >= ?").bind(sinceMs).first<{ n: number }>())?.n ?? 0;
  }

  async recentScans(limit: number): Promise<ScanResult[]> {
    const { results } = await this.db.prepare("SELECT result_json FROM scans ORDER BY scanned_ms DESC, id DESC LIMIT ?").bind(limit).all<{ result_json: string }>();
    return results.map((x) => JSON.parse(x.result_json));
  }

  async freshScan(address: string, sinceMs: number): Promise<ScanResult | null> {
    const row = await this.db.prepare("SELECT result_json FROM scans WHERE address = ? AND scanned_ms >= ? ORDER BY scanned_ms DESC LIMIT 1").bind(address, sinceMs).first<{ result_json: string }>();
    return row ? JSON.parse(row.result_json) : null;
  }

  async tickerOthers(tickerNorm: string, address: string, nowMs: number): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(DISTINCT address) AS n FROM scans WHERE ticker_norm = ? AND address != ? AND scanned_ms >= ?").bind(tickerNorm, address, nowMs - 7 * DAY).first<{ n: number }>();
    return row?.n ?? 0;
  }

  // Counts this call and returns how many calls this caller has made in the current hour (this one included).
  async hit(key: string, nowMs: number): Promise<number> {
    const hour = Math.floor(nowMs / 3_600_000);
    const row = await this.db.prepare(
      "INSERT INTO rate_limits (key, hour, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN hour = excluded.hour THEN count + 1 ELSE 1 END, hour = excluded.hour RETURNING count",
    ).bind(key, hour).first<{ count: number }>();
    return row?.count ?? 1;
  }

  // true when the nonce was new (and is now taken).
  async takeNonce(nonce: string, nowMs: number): Promise<boolean> {
    const r = await this.db.prepare("INSERT OR IGNORE INTO nonces (nonce, created_ms) VALUES (?, ?)").bind(nonce, nowMs).run();
    return (r.meta.changes ?? 0) > 0;
  }
  async releaseNonce(nonce: string): Promise<void> {
    await this.db.prepare("DELETE FROM nonces WHERE nonce = ?").bind(nonce).run();
  }

  // Workers AI neuron counter, one row per UTC day. The upsert adds inside SQL, so concurrent calls never lose an add.
  async aiUsed(day: string): Promise<number> {
    const r = await this.db.prepare("SELECT neurons FROM ai_usage WHERE day = ?").bind(day).first<{ neurons: number }>();
    return r?.neurons ?? 0;
  }
  async aiAdd(day: string, neurons: number): Promise<number> {
    const r = await this.db.prepare("INSERT INTO ai_usage (day, neurons) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET neurons = neurons + excluded.neurons RETURNING neurons").bind(day, neurons).first<{ neurons: number }>();
    return r?.neurons ?? neurons;
  }

  // CoinGecko call budget. One statement = one D1 subrequest: it counts the call only while the day's total is under `cap`
  // and this caller is under `share`, so concurrent callers cannot overshoot. true = go ahead, false = skip CoinGecko.
  async cgReserve(day: string, caller: CgCaller, cap: number, share: number): Promise<boolean> {
    const r = await this.db.prepare(
      "INSERT INTO cg_usage (day, caller, n) SELECT ?1, ?2, 1 WHERE (SELECT COALESCE(SUM(n), 0) FROM cg_usage WHERE day = ?1) < ?3 AND (SELECT COALESCE(SUM(n), 0) FROM cg_usage WHERE day = ?1 AND caller = ?2) < ?4 ON CONFLICT(day, caller) DO UPDATE SET n = n + 1 RETURNING n",
    ).bind(day, caller, cap, share).first<{ n: number }>();
    return r !== null;
  }
  // The gate market.ts calls before each CoinGecko request. cap 0 = no cap (and no D1 call). Scans may use the whole day;
  // radar and watch at most a third each, so user-facing scans always have the rest.
  cgGate(caller: CgCaller, cap: number, now: () => number): (() => Promise<boolean>) | undefined {
    if (!(cap > 0)) return undefined;
    const share = caller === "scan" ? cap : Math.floor(cap / 3);
    return () => this.cgReserve(new Date(now()).toISOString().slice(0, 10), caller, cap, share).catch(() => false); // D1 down: stay off the metered API
  }

  async prune(nowMs: number): Promise<void> {
    await this.db.batch([
      this.db.prepare("DELETE FROM ai_usage WHERE day < ?").bind(new Date(nowMs - 7 * DAY).toISOString().slice(0, 10)),
      this.db.prepare("DELETE FROM cg_usage WHERE day < ?").bind(new Date(nowMs - 7 * DAY).toISOString().slice(0, 10)),
      this.db.prepare("DELETE FROM rate_limits WHERE hour < ?").bind(Math.floor(nowMs / 3_600_000) - 2),
      this.db.prepare("DELETE FROM scans WHERE scanned_ms < ? AND source IN ('web','telegram')").bind(nowMs - 30 * DAY),
    ]);
  }

  // ---- radar
  async radarSeen(addresses: string[]): Promise<Set<string>> {
    if (!addresses.length) return new Set();
    const { results } = await this.db.prepare(`SELECT address FROM radar WHERE address IN (${addresses.map(() => "?").join(",")})`).bind(...addresses).all<{ address: string }>();
    return new Set(results.map((r) => r.address));
  }
  async radarInsert(r: { address: string; symbol: string | null; name: string | null; flags: string[]; poolAgeHours: number | null; firstSeenMs: number; score: number; verdict: string; liquidity: number | null }): Promise<void> {
    await this.db.prepare("INSERT OR IGNORE INTO radar (address, symbol, name, flags_json, pool_age_hours, first_seen_ms, score, verdict, liquidity_first) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(r.address, r.symbol, r.name, JSON.stringify(r.flags), r.poolAgeHours, r.firstSeenMs, r.score, r.verdict, r.liquidity).run();
  }
  async radarDue(beforeMs: number, limit: number): Promise<RadarRow[]> {
    const { results } = await this.db.prepare("SELECT * FROM radar WHERE outcome IS NULL AND first_seen_ms <= ? ORDER BY first_seen_ms LIMIT ?").bind(beforeMs, limit).all<RadarRow>();
    return results;
  }
  // One D1 round trip for all outcomes (a batch counts as one subrequest).
  async radarSetOutcomes(rows: { address: string; liquidityNow: number | null; outcome: string }[], nowMs: number): Promise<void> {
    if (!rows.length) return;
    await this.db.batch(rows.map((r) => this.db.prepare("UPDATE radar SET liquidity_now = ?, outcome = ?, recheck_ms = ? WHERE address = ?").bind(r.liquidityNow, r.outcome, nowMs, r.address)));
  }
  async radarSummary() {
    const [tot, since, latest] = await Promise.all([
      this.db.prepare("SELECT COUNT(*) AS scanned, COUNT(outcome) AS rechecked, SUM(outcome = 'held') AS held, SUM(outcome = 'up') AS up, SUM(outcome = 'down') AS down, SUM(outcome = 'drained') AS drained FROM radar").first<Record<string, number | null>>(),
      this.db.prepare("SELECT MIN(first_seen_ms) AS since FROM radar").first<{ since: number | null }>(),
      this.db.prepare("SELECT * FROM radar ORDER BY first_seen_ms DESC LIMIT 20").all<RadarRow>(),
    ]);
    return { tot, since: since?.since ?? null, latest: latest.results };
  }

  // ---- watch
  async watchCount(chatId: string): Promise<number> {
    const r = await this.db.prepare("SELECT COUNT(*) AS n FROM watches WHERE chat_id = ?").bind(chatId).first<{ n: number }>();
    return r?.n ?? 0;
  }
  async watchHas(chatId: string, address: string): Promise<boolean> {
    return (await this.db.prepare("SELECT 1 AS x FROM watches WHERE chat_id = ? AND address = ?").bind(chatId, address).first()) !== null;
  }
  async watchUpsert(chatId: string, address: string, symbol: string | null, state: WatchState, nowMs: number): Promise<void> {
    await this.db.prepare("INSERT INTO watches (chat_id, address, symbol, created_ms, last_checked_ms, last_state_json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id, address) DO UPDATE SET symbol = excluded.symbol, last_checked_ms = excluded.last_checked_ms, last_state_json = excluded.last_state_json")
      .bind(chatId, address, symbol, nowMs, nowMs, JSON.stringify(state)).run();
  }
  async watchTouch(chatId: string, address: string, nowMs: number): Promise<void> {
    await this.db.prepare("UPDATE watches SET last_checked_ms = ? WHERE chat_id = ? AND address = ?").bind(nowMs, chatId, address).run();
  }
  async watchRemove(chatId: string, address: string): Promise<boolean> {
    const r = await this.db.prepare("DELETE FROM watches WHERE chat_id = ? AND address = ?").bind(chatId, address).run();
    return (r.meta.changes ?? 0) > 0;
  }
  async watchList(chatId: string): Promise<WatchRow[]> {
    const { results } = await this.db.prepare("SELECT * FROM watches WHERE chat_id = ? ORDER BY created_ms").bind(chatId).all<any>();
    return results.map(toWatch);
  }
  async watchOldestChecked(limit: number): Promise<WatchRow[]> {
    const { results } = await this.db.prepare("SELECT * FROM watches ORDER BY last_checked_ms LIMIT ?").bind(limit).all<any>();
    return results.map(toWatch);
  }
}

const toWatch = (r: any): WatchRow => ({ chat_id: r.chat_id, address: r.address, symbol: r.symbol, created_ms: r.created_ms, last_checked_ms: r.last_checked_ms, state: JSON.parse(r.last_state_json) });
