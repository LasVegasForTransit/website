-- Operational mismatch dates contain stable identifiers only, never contact profiles.
CREATE TABLE access_mismatch_observations (
  provider TEXT NOT NULL CHECK(provider IN ('google_workspace','discord')),
  context_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  expected_access INTEGER NOT NULL CHECK(expected_access IN (0,1)),
  first_seen_at TEXT NOT NULL CHECK(julianday(first_seen_at) IS NOT NULL),
  last_seen_at TEXT NOT NULL CHECK(julianday(last_seen_at)>=julianday(first_seen_at)),
  PRIMARY KEY(provider,context_id,resource_id,identity_id)
);
CREATE INDEX access_mismatch_person ON access_mismatch_observations(person_id,provider,resource_id);
CREATE TRIGGER access_mismatch_archive_cleanup AFTER UPDATE OF deleted_at ON people
WHEN NEW.deleted_at IS NOT NULL
BEGIN DELETE FROM access_mismatch_observations WHERE person_id=NEW.id; END;

-- Shared Discord roles use the union of current committee entitlements.
-- An unknown or superseded read preserves the first-seen date without confirming a mismatch.
CREATE TRIGGER discord_mismatch_observed AFTER INSERT ON access_observations
WHEN NEW.provider='discord' AND NEW.target_id<>'person' AND NEW.state IN ('granted','absent')
 AND NOT EXISTS(SELECT 1 FROM access_observations newer WHERE newer.person_id=NEW.person_id
   AND newer.provider=NEW.provider AND newer.context_id=NEW.context_id AND newer.resource_id=NEW.resource_id
   AND (newer.observed_at>NEW.observed_at OR (newer.observed_at=NEW.observed_at AND newer.rowid>NEW.rowid)))
BEGIN
 DELETE FROM access_mismatch_observations
 WHERE provider=NEW.provider AND context_id=NEW.context_id AND resource_id=NEW.resource_id AND identity_id=NEW.identity_id
   AND last_seen_at<=NEW.observed_at
   AND (CASE NEW.state WHEN 'granted' THEN 1 ELSE 0 END)=(CASE WHEN EXISTS(
     SELECT 1 FROM people p JOIN committee_assignments a ON a.person_id=p.id JOIN committees c ON c.id=a.committee_id
     WHERE p.id=NEW.person_id AND p.deleted_at IS NULL AND p.membership_status='member' AND a.ended_at IS NULL
       AND (c.discord_role_id=NEW.resource_id OR (a.role='lead' AND c.discord_lead_role_id=NEW.resource_id))) THEN 1 ELSE 0 END);
 INSERT INTO access_mismatch_observations(provider,context_id,resource_id,identity_id,person_id,expected_access,first_seen_at,last_seen_at)
 SELECT NEW.provider,NEW.context_id,NEW.resource_id,NEW.identity_id,NEW.person_id,expected,NEW.observed_at,NEW.observed_at
 FROM (SELECT CASE WHEN EXISTS(
   SELECT 1 FROM people p JOIN committee_assignments a ON a.person_id=p.id JOIN committees c ON c.id=a.committee_id
   WHERE p.id=NEW.person_id AND p.deleted_at IS NULL AND p.membership_status='member' AND a.ended_at IS NULL
     AND (c.discord_role_id=NEW.resource_id OR (a.role='lead' AND c.discord_lead_role_id=NEW.resource_id))) THEN 1 ELSE 0 END AS expected)
 WHERE (CASE NEW.state WHEN 'granted' THEN 1 ELSE 0 END)<>expected
 ON CONFLICT(provider,context_id,resource_id,identity_id) DO UPDATE SET
   person_id=excluded.person_id,expected_access=excluded.expected_access,
   first_seen_at=(CASE WHEN access_mismatch_observations.person_id=excluded.person_id
     AND access_mismatch_observations.expected_access=excluded.expected_access THEN access_mismatch_observations.first_seen_at ELSE excluded.first_seen_at END),
   last_seen_at=excluded.last_seen_at
 WHERE excluded.last_seen_at>=access_mismatch_observations.last_seen_at;
END;
