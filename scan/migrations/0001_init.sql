-- Forge402 scan worker. Every table holds real observations only; nothing is seeded.

-- Every scan (web, paid, radar, telegram). result_json is the exact answer that was returned.
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  ticker_norm TEXT,
  score INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  source TEXT NOT NULL,            -- web | paid | radar | telegram
  scanned_ms INTEGER NOT NULL,
  result_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scans_address ON scans (address, scanned_ms);
CREATE INDEX IF NOT EXISTS scans_ticker ON scans (ticker_norm, scanned_ms);
CREATE INDEX IF NOT EXISTS scans_recent ON scans (scanned_ms);

-- Free-tier counter: one row per (hashed ip, hour).
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  hour INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- x402 replay guard: an EIP-3009 authorization nonce can pay once.
CREATE TABLE IF NOT EXISTS nonces (
  nonce TEXT PRIMARY KEY,
  created_ms INTEGER NOT NULL
);

-- Launch Radar track record. One row per token the radar scanned on first sight.
CREATE TABLE IF NOT EXISTS radar (
  address TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  flags_json TEXT NOT NULL DEFAULT '[]',   -- labels of the checks that flagged, at first sight
  pool_age_hours REAL,
  first_seen_ms INTEGER NOT NULL,
  score INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  liquidity_first REAL,
  liquidity_now REAL,
  recheck_ms INTEGER,
  outcome TEXT                     -- held | up | down | drained, null until rechecked
);
CREATE INDEX IF NOT EXISTS radar_due ON radar (outcome, first_seen_ms);

-- Forge Watch: one row per (chat, token). last_state_json is the previous reading.
CREATE TABLE IF NOT EXISTS watches (
  chat_id TEXT NOT NULL,
  address TEXT NOT NULL,
  symbol TEXT,
  created_ms INTEGER NOT NULL,
  last_checked_ms INTEGER NOT NULL,
  last_state_json TEXT NOT NULL,
  PRIMARY KEY (chat_id, address)
);
CREATE INDEX IF NOT EXISTS watches_checked ON watches (last_checked_ms);
