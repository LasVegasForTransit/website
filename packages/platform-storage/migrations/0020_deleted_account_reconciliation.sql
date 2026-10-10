-- Ordinary deletion keeps stable IDs until managed access has been removed.
-- Merges own their reconciliation and must not enqueue ordinary deletion work.
CREATE TRIGGER deleted_account_access AFTER UPDATE OF deleted_at ON people
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM merges WHERE merged_person_id=NEW.id AND merged_at=NEW.deleted_at AND unmerged_at IS NULL)
  AND (EXISTS(SELECT 1 FROM identities WHERE person_id=NEW.id AND platform IN ('discord','google_workspace','beehiiv'))
    OR EXISTS(SELECT 1 FROM reconcile_generations WHERE person_id=NEW.id))
BEGIN
  INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(NEW.id,'person',1)
    ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1;
  UPDATE reconcile_generations SET generation=generation+1 WHERE person_id=NEW.id AND target_id<>'person';
  UPDATE integration_outbox SET state='superseded',updated_at=NEW.updated_at
    WHERE person_id=NEW.id AND state IN ('queued','running','retry');
  INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
    SELECT lower(hex(randomblob(16))),'person_reconcile',NEW.id,'person',generation,
      json_object('source','person_deleted','deletedAt',NEW.deleted_at),NEW.updated_at,NEW.updated_at,NEW.updated_at
    FROM reconcile_generations WHERE person_id=NEW.id AND target_id='person';
END;

-- Upgrade existing ordinary deletions too. Active merges remain under merge reconciliation.
INSERT INTO reconcile_generations(person_id,target_id,generation)
  SELECT p.id,'person',1 FROM people p WHERE p.deleted_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id AND m.merged_at=p.deleted_at AND m.unmerged_at IS NULL)
    AND (EXISTS(SELECT 1 FROM identities WHERE person_id=p.id AND platform IN ('discord','google_workspace','beehiiv'))
      OR EXISTS(SELECT 1 FROM reconcile_generations WHERE person_id=p.id))
  ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1;
UPDATE reconcile_generations SET generation=generation+1 WHERE target_id<>'person' AND person_id IN (
  SELECT p.id FROM people p WHERE p.deleted_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id AND m.merged_at=p.deleted_at AND m.unmerged_at IS NULL)
    AND EXISTS(SELECT 1 FROM reconcile_generations g WHERE g.person_id=p.id AND g.target_id='person')
);
UPDATE integration_outbox SET state='superseded',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE state IN ('queued','running','retry') AND person_id IN (
    SELECT p.id FROM people p WHERE p.deleted_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id AND m.merged_at=p.deleted_at AND m.unmerged_at IS NULL)
      AND EXISTS(SELECT 1 FROM reconcile_generations g WHERE g.person_id=p.id AND g.target_id='person')
  );
INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
  SELECT lower(hex(randomblob(16))),'person_reconcile',p.id,'person',g.generation,
    json_object('source','person_deleted','deletedAt',p.deleted_at),
    strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM people p JOIN reconcile_generations g ON g.person_id=p.id AND g.target_id='person'
  WHERE p.deleted_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id AND m.merged_at=p.deleted_at AND m.unmerged_at IS NULL);
DELETE FROM access_observations WHERE person_id IN (
  SELECT p.id FROM people p WHERE p.deleted_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id AND m.merged_at=p.deleted_at AND m.unmerged_at IS NULL)
);
