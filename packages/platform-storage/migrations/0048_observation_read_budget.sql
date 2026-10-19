-- Shared committee roles compare observations by provider resource, not target.
-- Keep the newer-observation trigger bounded as historical snapshots accumulate.
CREATE INDEX access_observation_resource_latest
  ON access_observations(person_id,provider,context_id,resource_id,observed_at DESC);
