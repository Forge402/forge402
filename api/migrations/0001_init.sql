-- Forge402 router: prepaid keys, usage ledger, refunds, one-time nonces, daily counters.
-- Money is stored as integer micro-USD (6 decimals, same as USDG atomic units) so balances never drift.

CREATE TABLE keys (
  id            TEXT PRIMARY KEY,            -- public id, "fk_" + 12 hex. Safe to show.
  hash          TEXT NOT NULL UNIQUE,        -- sha256 hex of the full forge_sk_ key. The key itself is never stored.
  owner         TEXT NOT NULL,               -- lowercase wallet address that funded it
  label         TEXT,
  balance_micro INTEGER NOT NULL DEFAULT 0 CHECK (balance_micro >= 0),
  spent_micro   INTEGER NOT NULL DEFAULT 0,
  deposited_micro INTEGER NOT NULL DEFAULT 0,
  calls         INTEGER NOT NULL DEFAULT 0,
  created       INTEGER NOT NULL,            -- unix ms
  revoked       INTEGER NOT NULL DEFAULT 0,
  closed        INTEGER                      -- unix ms
);
CREATE INDEX keys_owner ON keys(owner);

-- One row per served call. No prompt or reply text, ever.
CREATE TABLE ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,             -- unix ms
  tenant       TEXT NOT NULL,                -- key id, payer wallet, or "playground"
  kind         TEXT NOT NULL DEFAULT 'chat', -- chat | embeddings | scan
  model        TEXT NOT NULL,
  tokens_in    INTEGER NOT NULL DEFAULT 0,
  tokens_out   INTEGER NOT NULL DEFAULT 0,
  cost_usd     REAL NOT NULL DEFAULT 0,      -- what the caller was charged (0 for free playground calls)
  cache        TEXT NOT NULL DEFAULT 'MISS', -- HIT | MISS | BYPASS
  discount_pct INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ledger_ts ON ledger(ts);
CREATE INDEX ledger_tenant_ts ON ledger(tenant, ts);

-- USDG owed back to a wallet. paid=0 until the owner sends it from the treasury.
CREATE TABLE refunds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,
  wallet       TEXT NOT NULL,
  amount_micro INTEGER NOT NULL CHECK (amount_micro > 0),
  reason       TEXT NOT NULL,                -- change | key_closed | failed_deposit
  ref          TEXT,                         -- key id or payment nonce
  paid         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX refunds_wallet ON refunds(wallet, paid);

-- One-time values: x402 authorization nonces (replay guard) and wallet sign-in nonces.
CREATE TABLE nonces (
  nonce   TEXT PRIMARY KEY,
  kind    TEXT NOT NULL,                     -- x402 | auth
  address TEXT,
  data    TEXT,                              -- auth: the exact message the wallet must sign
  expires INTEGER NOT NULL
);

-- Free-message counters (playground). scope is a hashed IP or a wallet; day is UTC.
CREATE TABLE daily_use (
  scope TEXT NOT NULL,
  day   TEXT NOT NULL,
  n     INTEGER NOT NULL,
  PRIMARY KEY (scope, day)
);
