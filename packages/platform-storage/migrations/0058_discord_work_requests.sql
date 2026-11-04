-- Observations contain only routing state; requests never contain page content.
CREATE TABLE discord_work_observations (
  route_id TEXT NOT NULL REFERENCES discord_work_routes(id),
  page_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
  edited_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(route_id,page_id)
);
CREATE TABLE discord_work_requests (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  route_id TEXT NOT NULL REFERENCES discord_work_routes(id),
  route_revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','processing','held','completed','superseded')),
  operation_id TEXT,
  reason TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(scope_key,source_id,page_id)
);
CREATE INDEX discord_work_requests_pending ON discord_work_requests(scope_key,state,created_at,id);
