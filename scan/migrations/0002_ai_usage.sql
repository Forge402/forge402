-- Workers AI daily budget (Free plan: 10,000 neurons/day per account). One row per UTC day, estimated neurons used.
CREATE TABLE IF NOT EXISTS ai_usage (
  day TEXT PRIMARY KEY,            -- YYYY-MM-DD, UTC
  neurons REAL NOT NULL DEFAULT 0
);
