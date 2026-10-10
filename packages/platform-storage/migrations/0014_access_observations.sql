CREATE TABLE access_observations (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  target_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('google_workspace','discord')),
  identity_id TEXT NOT NULL,
  identity_email TEXT,
  resource_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation>=0),
  expected_access INTEGER NOT NULL CHECK(expected_access IN (0,1)),
  state TEXT NOT NULL CHECK(state IN ('granted','absent','unknown')),
  failure TEXT CHECK(failure IS NULL OR failure IN ('provider_unavailable','rate_limited','permission_denied','unknown')),
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK(state='unknown' OR failure IS NULL)
);
CREATE INDEX access_observation_latest ON access_observations(person_id,target_id,provider,observed_at DESC,id DESC);
CREATE TRIGGER access_observations_append_only BEFORE UPDATE ON access_observations
BEGIN SELECT RAISE(ABORT,'access confirmations cannot be changed'); END;
