CREATE TABLE paper_batches (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES people(id),
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  wording_version TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  created_at TEXT NOT NULL,
  applied_at TEXT
);
CREATE INDEX paper_batches_actor ON paper_batches(actor_id,created_at);
