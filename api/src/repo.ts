// Data access for D1: keys, ledger, refunds, nonces, daily counters, stats. SQL only, no business rules.
// Every balance change is ONE conditional UPDATE and the rows changed are checked, so parallel calls can never
// push a balance below zero (D1 runs each statement atomically).
import type { D1Like } from "./env.ts";

export type KeyRow = {
  id: string; hash: string; owner: string; label: string | null;
  balance_micro: number; spent_micro: number; deposited_micro: number; calls: number;
  created: number; revoked: number; closed: number | null;
};
export type LedgerEntry = {
  ts: number; tenant: string; kind?: "chat" | "embeddings" | "scan"; model: string;
  tokens_in: number; tokens_out: number; cost_micro: number; cache: "HIT" | "MISS" | "BYPASS"; discount_pct: number;
};
// pending_settle: a settlement was still unconfirmed when we gave up waiting and the work was withheld. Not owed until
// the owner sees on chain that it landed (then set reason='change'); if it never landed, delete the row.
export type RefundReason = "change" | "key_closed" | "failed_deposit" | "pending_settle";

const changed = (r: { meta: { changes?: number } }): boolean => (r.meta.changes ?? 0) > 0;

export function createRepo(db: D1Like) {
  const insertRefund = (ts: number, wallet: string, amount: number, reason: RefundReason, ref: string | null) =>
    db.prepare("INSERT INTO refunds (ts, wallet, amount_micro, reason, ref) VALUES (?, ?, ?, ?, ?)").bind(ts, wallet.toLowerCase(), amount, reason, ref);

  return {
    // ---- keys ----
    async createKey(k: { id: string; hash: string; owner: string; label: string | null; amount: number; now: number }): Promise<void> {
      await db
        .prepare("INSERT INTO keys (id, hash, owner, label, balance_micro, deposited_micro, created) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(k.id, k.hash, k.owner.toLowerCase(), k.label, k.amount, k.amount, k.now)
        .run();
    },
    keyByHash: (hash: string) => db.prepare("SELECT * FROM keys WHERE hash = ?").bind(hash).first<KeyRow>(),
    keyById: (id: string) => db.prepare("SELECT * FROM keys WHERE id = ?").bind(id).first<KeyRow>(),
    async keysOfOwner(owner: string): Promise<KeyRow[]> {
      return (await db.prepare("SELECT * FROM keys WHERE owner = ? ORDER BY created DESC").bind(owner.toLowerCase()).all<KeyRow>()).results;
    },

    // Take `amount` out of a live key. false = not enough balance or key closed. This is the race-safe debit.
    async debit(id: string, amount: number): Promise<boolean> {
      return changed(
        await db.prepare("UPDATE keys SET balance_micro = balance_micro - ? WHERE id = ? AND revoked = 0 AND balance_micro >= ?").bind(amount, id, amount).run(),
      );
    },
    // After a call: give back what was reserved but not used, count the spend. false = key was closed meanwhile.
    async settleKey(id: string, back: number, spent: number, counted: boolean): Promise<boolean> {
      return changed(
        await db
          .prepare("UPDATE keys SET balance_micro = balance_micro + ?, spent_micro = spent_micro + ?, calls = calls + ? WHERE id = ? AND revoked = 0")
          .bind(back, spent, counted ? 1 : 0, id)
          .run(),
      );
    },
    async credit(id: string, amount: number): Promise<boolean> {
      return changed(
        await db.prepare("UPDATE keys SET balance_micro = balance_micro + ?, deposited_micro = deposited_micro + ? WHERE id = ? AND revoked = 0").bind(amount, amount, id).run(),
      );
    },
    // Close: the remaining balance becomes a refund row, atomically with the revoke. Returns the amount, null if it was already closed.
    async closeKey(id: string, now: number): Promise<number | null> {
      const row = await db.prepare("SELECT balance_micro FROM keys WHERE id = ? AND revoked = 0").bind(id).first<{ balance_micro: number }>();
      if (!row) return null;
      const [ins, upd] = await db.batch([
        db.prepare("INSERT INTO refunds (ts, wallet, amount_micro, reason, ref) SELECT ?, owner, balance_micro, 'key_closed', id FROM keys WHERE id = ? AND revoked = 0 AND balance_micro > 0").bind(now, id),
        db.prepare("UPDATE keys SET revoked = 1, closed = ?, balance_micro = 0 WHERE id = ? AND revoked = 0").bind(now, id),
      ]);
      return changed(upd) ? (changed(ins) ? row.balance_micro : 0) : null;
    },

    // ---- ledger and refunds ----
    async addLedger(e: LedgerEntry): Promise<void> {
      await db
        .prepare("INSERT INTO ledger (ts, tenant, kind, model, tokens_in, tokens_out, cost_usd, cache, discount_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(e.ts, e.tenant, e.kind ?? "chat", e.model, e.tokens_in, e.tokens_out, e.cost_micro / 1_000_000, e.cache, e.discount_pct)
        .run();
    },
    async addRefund(now: number, wallet: string, amount: number, reason: RefundReason, ref: string | null): Promise<void> {
      if (amount > 0) await insertRefund(now, wallet, amount, reason, ref).run();
    },
    async refundsOwed(wallet: string): Promise<number> {
      const r = await db.prepare("SELECT COALESCE(SUM(amount_micro), 0) AS n FROM refunds WHERE wallet = ? AND paid = 0 AND reason != 'pending_settle'").bind(wallet.toLowerCase()).first<{ n: number }>();
      return r?.n ?? 0;
    },
    recent: async (tenant: string, limit = 20) =>
      (
        await db
          .prepare("SELECT ts, model, tokens_in, tokens_out, cost_usd, cache FROM ledger WHERE tenant = ? ORDER BY id DESC LIMIT ?")
          .bind(tenant, limit)
          .all<{ ts: number; model: string; tokens_in: number; tokens_out: number; cost_usd: number; cache: string }>()
      ).results,

    // ---- one-time nonces ----
    async hasNonce(nonce: string): Promise<boolean> {
      return !!(await db.prepare("SELECT 1 AS x FROM nonces WHERE nonce = ? AND kind = 'x402'").bind(nonce).first());
    },
    // false = already used (replay).
    async claimNonce(nonce: string, kind: "x402" | "auth", expires: number, address: string | null = null, data: string | null = null): Promise<boolean> {
      return changed(await db.prepare("INSERT OR IGNORE INTO nonces (nonce, kind, address, data, expires) VALUES (?, ?, ?, ?, ?)").bind(nonce, kind, address, data, expires).run());
    },
    async releaseNonce(nonce: string): Promise<void> {
      await db.prepare("DELETE FROM nonces WHERE nonce = ?").bind(nonce).run();
    },
    // Wallet sign-in: take the nonce exactly once; returns the message that was issued, or null.
    async takeAuthNonce(nonce: string, address: string, now: number): Promise<string | null> {
      const row = await db.prepare("SELECT data FROM nonces WHERE nonce = ? AND kind = 'auth' AND address = ? AND expires > ?").bind(nonce, address.toLowerCase(), now).first<{ data: string }>();
      if (!row) return null;
      const r = await db.prepare("DELETE FROM nonces WHERE nonce = ? AND kind = 'auth'").bind(nonce).run();
      return changed(r) ? row.data : null;
    },
    async sweepNonces(now: number): Promise<void> {
      // Only sign-in nonces expire. x402 nonces are kept for good: a signed authorization can stay valid on chain for
      // longer than any sweep window, so forgetting it would let the same signature be sent again.
      await db.prepare("DELETE FROM nonces WHERE kind = 'auth' AND expires < ?").bind(now).run();
    },

    // ---- daily free counters ----
    // Take one slot of `limit` for scope+day. false = used up. Race-safe: one upsert whose WHERE guards the count.
    async takeDaily(scope: string, day: string, limit: number): Promise<boolean> {
      return changed(
        await db.prepare("INSERT INTO daily_use (scope, day, n) VALUES (?, ?, 1) ON CONFLICT(scope, day) DO UPDATE SET n = n + 1 WHERE n < ?").bind(scope, day, limit).run(),
      );
    },
    // Add n to scope+day (neuron counting). One upsert, so parallel calls never lose an add.
    async addDaily(scope: string, day: string, n: number): Promise<void> {
      await db.prepare("INSERT INTO daily_use (scope, day, n) VALUES (?, ?, ?) ON CONFLICT(scope, day) DO UPDATE SET n = n + excluded.n").bind(scope, day, n).run();
    },
    async giveBackDaily(scope: string, day: string): Promise<void> {
      await db.prepare("UPDATE daily_use SET n = n - 1 WHERE scope = ? AND day = ? AND n > 0").bind(scope, day).run();
    },
    async usedDaily(scope: string, day: string): Promise<number> {
      return (await db.prepare("SELECT n FROM daily_use WHERE scope = ? AND day = ?").bind(scope, day).first<{ n: number }>())?.n ?? 0;
    },

    // ---- stats (ledger only) ----
    async stats(sinceMs: number) {
      const totals = await db
        .prepare(
          `SELECT COALESCE(SUM(tokens_in),0) AS tokens_in, COALESCE(SUM(tokens_out),0) AS tokens_out,
                  COALESCE(SUM(CASE WHEN kind != 'scan' THEN 1 ELSE 0 END),0) AS calls,
                  COALESCE(SUM(CASE WHEN kind = 'scan' THEN 1 ELSE 0 END),0) AS scans,
                  COALESCE(SUM(cost_usd),0) AS volume_usd,
                  COALESCE(SUM(CASE WHEN cache = 'HIT' THEN 1 ELSE 0 END),0) AS hits,
                  COALESCE(SUM(CASE WHEN cache IN ('HIT','MISS') THEN 1 ELSE 0 END),0) AS cacheable
             FROM ledger WHERE ts >= ?`,
        )
        .bind(sinceMs)
        .first<{ tokens_in: number; tokens_out: number; calls: number; scans: number; volume_usd: number; hits: number; cacheable: number }>();
      const per_model = (
        await db
          .prepare("SELECT model, COUNT(*) AS calls, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out FROM ledger WHERE ts >= ? AND kind != 'scan' GROUP BY model ORDER BY calls DESC LIMIT 50")
          .bind(sinceMs)
          .all<{ model: string; calls: number; tokens_in: number; tokens_out: number }>()
      ).results;
      const daily = (
        await db
          .prepare("SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS day, COUNT(*) AS calls FROM ledger WHERE ts >= ? AND kind != 'scan' GROUP BY day ORDER BY day")
          .bind(sinceMs)
          .all<{ day: string; calls: number }>()
      ).results;
      return { totals: totals!, per_model, daily };
    },
  };
}
export type Repo = ReturnType<typeof createRepo>;
