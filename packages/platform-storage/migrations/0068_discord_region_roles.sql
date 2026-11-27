ALTER TABLE people ADD COLUMN discord_region_visible INTEGER NOT NULL DEFAULT 1
  CHECK(discord_region_visible IN (0,1));
ALTER TABLE regions ADD COLUMN discord_role_id TEXT;
ALTER TABLE regions ADD COLUMN settings_version INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX region_discord_role_unique ON regions(discord_role_id)
  WHERE discord_role_id IS NOT NULL;

-- Retired mappings remain managed until Discord has removed them from every account.
CREATE TABLE discord_region_role_mappings (
  region_id TEXT NOT NULL REFERENCES regions(id),
  external_id TEXT NOT NULL UNIQUE,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(region_id,external_id)
);
CREATE TRIGGER discord_region_mapping_history AFTER UPDATE OF discord_role_id ON regions
WHEN OLD.discord_role_id IS NOT NEW.discord_role_id
BEGIN
  INSERT INTO discord_region_role_mappings(region_id,external_id,recorded_at)
    SELECT NEW.id,OLD.discord_role_id,NEW.updated_at WHERE OLD.discord_role_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  INSERT INTO discord_region_role_mappings(region_id,external_id,recorded_at)
    SELECT NEW.id,NEW.discord_role_id,NEW.updated_at WHERE NEW.discord_role_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  INSERT INTO reconcile_generations(person_id,target_id,generation)
    SELECT p.id,'person',1 FROM people p WHERE p.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM identities i WHERE i.person_id=p.id AND i.platform='discord')
    ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1;
  INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
    SELECT lower(hex(randomblob(16))),'person_reconcile',p.id,'person',g.generation,
      json_object('source','region_settings'),NEW.updated_at,NEW.updated_at,NEW.updated_at
    FROM people p JOIN reconcile_generations g ON g.person_id=p.id AND g.target_id='person'
    WHERE p.deleted_at IS NULL AND EXISTS(SELECT 1 FROM identities i WHERE i.person_id=p.id AND i.platform='discord');
END;

CREATE TRIGGER discord_region_person_change AFTER UPDATE OF region_id,discord_region_visible ON people
WHEN NEW.deleted_at IS NULL AND (OLD.region_id IS NOT NEW.region_id
  OR OLD.discord_region_visible IS NOT NEW.discord_region_visible)
  AND EXISTS(SELECT 1 FROM identities WHERE person_id=NEW.id AND platform='discord')
BEGIN
  INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(NEW.id,'person',1)
    ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1;
  INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
    SELECT lower(hex(randomblob(16))),'person_reconcile',NEW.id,'person',generation,
      json_object('source','region_preference'),NEW.updated_at,NEW.updated_at,NEW.updated_at
    FROM reconcile_generations WHERE person_id=NEW.id AND target_id='person';
END;
