CREATE TABLE IF NOT EXISTS deposit_events (
  exchange TEXT NOT NULL,
  uid TEXT NOT NULL,
  event_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  usdt_amount TEXT,
  occurred_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('deposit','own_transfer')),
  PRIMARY KEY(exchange,uid,event_id)
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  key TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('pending','sending','sent','unknown')),
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS qualification_locks (
  page_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_bindings (
  exchange TEXT NOT NULL,
  uid TEXT NOT NULL,
  page_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(exchange,uid)
);
CREATE TABLE IF NOT EXISTS membership_transitions (
  event_key TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  from_tier TEXT NOT NULL,
  to_tier TEXT NOT NULL,
  window_end TEXT,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  handled_at TEXT
);
