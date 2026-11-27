-- Historical and current public event slugs keyed to stable UID-derived IDs,
-- plus the latest good Google Calendar ICS and parsed JSON snapshot for O(1)
-- conditional revalidation and outage fallback.
CREATE TABLE event_slugs (
  slug TEXT PRIMARY KEY,
  stable_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX idx_event_slugs_stable_current ON event_slugs (stable_id, is_current);
CREATE INDEX idx_event_slugs_uid_current ON event_slugs (uid, is_current);

CREATE TABLE event_feed_snapshots (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ics_sha256 TEXT NOT NULL,
  ics_etag TEXT,
  parsed_json TEXT NOT NULL,
  ics_text TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
