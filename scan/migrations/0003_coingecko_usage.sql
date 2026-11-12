-- CoinGecko Demo plan daily call budget (about 10,000 calls per month). One row per UTC day and caller (scan, radar, watch).
CREATE TABLE IF NOT EXISTS cg_usage (
  day TEXT NOT NULL,               -- YYYY-MM-DD, UTC
  caller TEXT NOT NULL,            -- 'scan' | 'radar' | 'watch'
  n INTEGER NOT NULL DEFAULT 0,    -- CoinGecko HTTP requests made, failures and retries included
  PRIMARY KEY (day, caller)
);
