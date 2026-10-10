-- Keep the version-1 membership cache and required access work inside the consent write.
-- The rule mirrors platform-core/membership.ts; a new rules version requires a migration.
CREATE TRIGGER membership_access_changed AFTER UPDATE OF membership_status ON people
WHEN OLD.membership_status<>NEW.membership_status AND NEW.deleted_at IS NULL
  AND (EXISTS(SELECT 1 FROM identities WHERE person_id=NEW.id AND platform IN ('discord','google_workspace','beehiiv'))
    OR EXISTS(SELECT 1 FROM reconcile_generations WHERE person_id=NEW.id))
BEGIN
  INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(NEW.id,'person',1)
    ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1;
  UPDATE reconcile_generations SET generation=generation+1 WHERE person_id=NEW.id AND target_id<>'person';
  UPDATE integration_outbox SET state='superseded',updated_at=NEW.updated_at
    WHERE person_id=NEW.id AND state IN ('queued','running','retry');
  INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
    SELECT lower(hex(randomblob(16))) || ':' || target_id,
      CASE WHEN target_id='person' THEN 'person_reconcile' ELSE 'committee_reconcile' END,
      person_id,target_id,generation,json_object('source','membership_change'),NEW.updated_at,NEW.updated_at,NEW.updated_at
    FROM reconcile_generations WHERE person_id=NEW.id;
END;

CREATE TRIGGER membership_consent_insert AFTER INSERT ON consent_records
WHEN NEW.scope='newsletter'
BEGIN
  UPDATE people SET membership_status=CASE WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NULL) THEN 'member'
    WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NOT NULL) THEN 'former_member' ELSE 'not_member' END,membership_rules_version=1,updated_at=NEW.updated_at
    WHERE id IN (NEW.person_id) AND deleted_at IS NULL AND coalesce(membership_rules_version,1)=1;
END;

CREATE TRIGGER membership_consent_update AFTER UPDATE OF person_id,scope,withdrawn_at ON consent_records
WHEN OLD.scope='newsletter' OR NEW.scope='newsletter'
BEGIN
  UPDATE people SET membership_status=CASE WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NULL) THEN 'member'
    WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NOT NULL) THEN 'former_member' ELSE 'not_member' END,membership_rules_version=1,updated_at=NEW.updated_at
    WHERE id IN (OLD.person_id,NEW.person_id) AND deleted_at IS NULL AND coalesce(membership_rules_version,1)=1;
END;

CREATE TRIGGER membership_consent_delete AFTER DELETE ON consent_records
WHEN OLD.scope='newsletter'
BEGIN
  UPDATE people SET membership_status=CASE WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NULL) THEN 'member'
    WHEN EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=people.id AND c.scope='newsletter' AND c.withdrawn_at IS NOT NULL) THEN 'former_member' ELSE 'not_member' END,membership_rules_version=1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id IN (OLD.person_id) AND deleted_at IS NULL AND coalesce(membership_rules_version,1)=1;
END;

