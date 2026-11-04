-- A source has at most one enabled route within a Discord workspace scope.
CREATE TABLE discord_work_routes (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','paused')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX discord_work_active_route_source
  ON discord_work_routes(scope_key,source_id) WHERE state='active';
CREATE INDEX discord_work_route_scope ON discord_work_routes(scope_key,state,id);
