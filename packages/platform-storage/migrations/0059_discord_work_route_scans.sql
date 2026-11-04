CREATE TABLE discord_work_route_scans (
  route_id TEXT PRIMARY KEY REFERENCES discord_work_routes(id),
  scope_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'scan' CHECK(mode IN ('scan','baseline')),
  baseline_completed_at TEXT,
  last_error TEXT,
  last_success_at TEXT,
  cursor TEXT,
  claim_token TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX discord_work_route_scans_due ON discord_work_route_scans(scope_key,next_attempt_at,route_id);
