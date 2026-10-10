-- Keep an opaque key for provider removal and historical attribution after the
-- personal profile reaches its retention deadline. Existing foreign keys move
-- with the old table; no identities, intents, receipts or actor references are
-- copied, dropped, or cascaded away. Recreate business triggers against profiles.

DROP TRIGGER engagement_events_no_single_delete;

DROP TRIGGER staff_admin_keep_last;

DROP TRIGGER staff_admin_no_delete_last_person;

DROP TRIGGER membership_access_changed;

DROP TRIGGER membership_consent_insert;

DROP TRIGGER membership_consent_update;

DROP TRIGGER membership_consent_delete;

DROP TRIGGER deleted_account_access;

DROP TRIGGER erased_person_no_restore;

DROP TRIGGER merges_bookkeeping_immutable;

DROP TRIGGER staff_audit_append_only;

DROP INDEX people_email;

DROP INDEX people_membership_status;

DROP INDEX people_region;

ALTER TABLE people RENAME TO person_keys;

CREATE TABLE people (
  id TEXT PRIMARY KEY REFERENCES person_keys(id),
  given_name TEXT,
  family_name TEXT,
  email TEXT,
  email_verified_at TEXT,
  phone TEXT,
  zip TEXT CHECK (zip IS NULL OR (length(zip) = 5 AND zip NOT GLOB '*[^0-9]*')),
  census_block TEXT CHECK (census_block IS NULL OR length(census_block) = 15),
  census_block_vintage TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  membership_status TEXT NOT NULL DEFAULT 'not_member'
    CHECK (membership_status IN ('member', 'former_member', 'not_member')),
  membership_rules_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  place_name TEXT,
  region_id TEXT REFERENCES regions(id),
  region_source TEXT CHECK (region_source IS NULL OR region_source IN ('staff','address','member_choice','zip')),
  region_set_at TEXT,
  erased_at TEXT CHECK (erased_at IS NULL OR deleted_at IS NOT NULL)
);

INSERT INTO people SELECT * FROM person_keys;

ALTER TABLE person_keys DROP COLUMN given_name;

ALTER TABLE person_keys DROP COLUMN family_name;

ALTER TABLE person_keys DROP COLUMN email;

ALTER TABLE person_keys DROP COLUMN email_verified_at;

ALTER TABLE person_keys DROP COLUMN phone;

ALTER TABLE person_keys DROP COLUMN zip;

ALTER TABLE person_keys DROP COLUMN census_block;

ALTER TABLE person_keys DROP COLUMN census_block_vintage;

ALTER TABLE person_keys DROP COLUMN preferred_language;

ALTER TABLE person_keys DROP COLUMN membership_status;

ALTER TABLE person_keys DROP COLUMN membership_rules_version;

ALTER TABLE person_keys DROP COLUMN created_at;

ALTER TABLE person_keys DROP COLUMN updated_at;

ALTER TABLE person_keys DROP COLUMN place_name;

ALTER TABLE person_keys DROP COLUMN region_id;

ALTER TABLE person_keys DROP COLUMN region_source;

ALTER TABLE person_keys DROP COLUMN region_set_at;

CREATE UNIQUE INDEX people_email ON people (email) WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX people_membership_status ON people (membership_status) WHERE deleted_at IS NULL;

CREATE INDEX people_region ON people (region_id) WHERE deleted_at IS NULL;

CREATE TRIGGER engagement_events_no_single_delete
BEFORE DELETE ON engagement_events
WHEN EXISTS (SELECT 1 FROM people WHERE id = OLD.person_id AND deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'engagement events are removed only with a deleted person');
END;

CREATE TRIGGER staff_admin_keep_last BEFORE DELETE ON staff_administrators
WHEN EXISTS (SELECT 1 FROM people WHERE id=OLD.person_id AND deleted_at IS NULL)
 AND (SELECT count(*) FROM staff_administrators a JOIN people p ON p.id=a.person_id AND p.deleted_at IS NULL)<=1
BEGIN SELECT RAISE(ABORT,'last_staff_administrator'); END;

CREATE TRIGGER staff_admin_no_delete_last_person BEFORE UPDATE OF deleted_at ON people
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
 AND EXISTS (SELECT 1 FROM staff_administrators WHERE person_id=OLD.id)
 AND (SELECT count(*) FROM staff_administrators a JOIN people p ON p.id=a.person_id AND p.deleted_at IS NULL)<=1
BEGIN SELECT RAISE(ABORT,'last_staff_administrator'); END;

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

CREATE TRIGGER erased_person_no_restore BEFORE UPDATE ON people
WHEN OLD.erased_at IS NOT NULL AND (
  NEW.erased_at IS NOT OLD.erased_at OR NEW.deleted_at IS NOT OLD.deleted_at
  OR NEW.given_name IS NOT NULL OR NEW.family_name IS NOT NULL OR NEW.email IS NOT NULL
  OR NEW.email_verified_at IS NOT NULL OR NEW.phone IS NOT NULL OR NEW.zip IS NOT NULL
  OR NEW.census_block IS NOT NULL OR NEW.census_block_vintage IS NOT NULL
  OR NEW.place_name IS NOT NULL OR NEW.region_id IS NOT NULL OR NEW.region_source IS NOT NULL
  OR NEW.region_set_at IS NOT NULL OR NEW.preferred_language<>'en')
BEGIN SELECT RAISE(ABORT,'erased personal data cannot be restored'); END;

CREATE TRIGGER merges_bookkeeping_immutable BEFORE UPDATE ON merges
WHEN NEW.id IS NOT OLD.id OR NEW.surviving_person_id IS NOT OLD.surviving_person_id
  OR NEW.merged_person_id IS NOT OLD.merged_person_id OR NEW.merged_at IS NOT OLD.merged_at
  OR NEW.merged_by IS NOT OLD.merged_by OR NEW.created_at IS NOT OLD.created_at
  OR NEW.operation_id IS NOT OLD.operation_id
  OR NOT (
    (NEW.moved_rows IS OLD.moved_rows AND NEW.reason IS OLD.reason AND NEW.erased_at IS OLD.erased_at)
    OR (NEW.reason IS OLD.reason AND NEW.erased_at IS OLD.erased_at
      AND NEW.unmerged_at IS OLD.unmerged_at AND NEW.unmerged_by IS OLD.unmerged_by
      AND NEW.moved_rows=json_set(OLD.moved_rows,'$.reviews',(
        SELECT json_group_array(json(review.value)) FROM json_each(OLD.moved_rows,'$.reviews') review
        WHERE NOT EXISTS(SELECT 1 FROM person_erasure_scope s JOIN people p ON p.id=s.person_id
          WHERE p.deleted_at IS NOT NULL AND p.erased_at=s.requested_at
            AND s.person_id IN (json_extract(review.value,'$.candidate_person_id'),json_extract(review.value,'$.existing_person_id')))))
      AND EXISTS(SELECT 1 FROM json_each(OLD.moved_rows,'$.reviews') review JOIN person_erasure_scope s
        ON s.person_id IN (json_extract(review.value,'$.candidate_person_id'),json_extract(review.value,'$.existing_person_id'))
        JOIN people p ON p.id=s.person_id WHERE p.deleted_at IS NOT NULL AND p.erased_at=s.requested_at))
    OR (NEW.moved_rows='{}' AND NEW.reason IS NULL AND NEW.unmerged_at IS OLD.unmerged_at
      AND NEW.unmerged_by IS OLD.unmerged_by AND EXISTS (
        SELECT 1 FROM person_erasure_scope s JOIN people p ON p.id=s.person_id
        WHERE (s.person_id IN (OLD.surviving_person_id,OLD.merged_person_id)
            OR EXISTS(SELECT 1 FROM person_erasure_copies c WHERE c.operation_id=s.operation_id
              AND c.person_id=OLD.merged_person_id AND EXISTS(SELECT 1 FROM merge_copy_intervals h
                WHERE h.id=OLD.id AND h.first_order BETWEEN c.first_order AND c.last_order)))
          AND p.deleted_at IS NOT NULL AND p.erased_at=s.requested_at
          AND NEW.erased_at=coalesce(OLD.erased_at,s.requested_at)))
  )
BEGIN SELECT RAISE(ABORT,'merge bookkeeping cannot be changed'); END;

CREATE TRIGGER staff_audit_append_only BEFORE UPDATE ON staff_audits
WHEN NOT (
  NEW.id IS OLD.id AND NEW.actor_id IS OLD.actor_id AND NEW.action IS OLD.action
  AND NEW.permission IS OLD.permission AND NEW.target_id IS OLD.target_id
  AND NEW.operation_id IS OLD.operation_id AND NEW.occurred_at IS OLD.occurred_at
  AND NEW.details='{"personalDataErased":true}'
  AND EXISTS (SELECT 1 FROM person_erasure_scope s JOIN people p ON p.id=s.person_id
    WHERE p.deleted_at IS NOT NULL AND p.erased_at=s.requested_at
      AND (OLD.target_id=s.person_id
        OR EXISTS(SELECT 1 FROM merges m WHERE m.id=OLD.target_id
          AND (s.person_id IN (m.surviving_person_id,m.merged_person_id)
            OR EXISTS(SELECT 1 FROM person_erasure_copies c WHERE c.operation_id=s.operation_id
              AND c.person_id=m.merged_person_id AND EXISTS(SELECT 1 FROM merge_copy_intervals h
                WHERE h.id=m.id AND h.first_order BETWEEN c.first_order AND c.last_order))))
        OR EXISTS(SELECT 1 FROM person_corrections c WHERE c.operation_id=OLD.operation_id AND c.person_id=s.person_id)))
)
BEGIN SELECT RAISE(ABORT,'staff audits cannot be changed'); END;

CREATE TRIGGER person_key_insert AFTER INSERT ON people
BEGIN
  INSERT INTO person_keys(id,deleted_at,erased_at) VALUES(NEW.id,NEW.deleted_at,NEW.erased_at)
    ON CONFLICT(id) DO NOTHING;
END;
CREATE TRIGGER person_key_update AFTER UPDATE OF deleted_at,erased_at ON people
BEGIN UPDATE person_keys SET deleted_at=NEW.deleted_at,erased_at=NEW.erased_at WHERE id=NEW.id; END;
CREATE TRIGGER person_key_no_restore BEFORE UPDATE ON person_keys
WHEN NEW.id IS NOT OLD.id OR (OLD.erased_at IS NOT NULL AND
  (NEW.erased_at IS NOT OLD.erased_at OR NEW.deleted_at IS NOT OLD.deleted_at))
BEGIN SELECT RAISE(ABORT,'erased person key cannot be restored'); END;
-- REPLACE can bypass DELETE triggers when recursive_triggers is off. Guard
-- insertion too, including replacement with a row that clears the erasure marker.
CREATE TRIGGER person_key_no_replace BEFORE INSERT ON person_keys
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id=NEW.id AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'erased person key cannot be replaced'); END;
CREATE TRIGGER person_key_no_delete BEFORE DELETE ON person_keys
WHEN OLD.erased_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'erased person key cannot be removed'); END;
CREATE TRIGGER person_profile_no_recreate BEFORE INSERT ON people
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id=NEW.id AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'erased profile cannot be recreated'); END;
-- The worker reads only membership and deletion state from this view. Deleted
-- profiles have no desired access, whether or not their profile row still exists.
CREATE VIEW reconciliation_people AS
  SELECT id,deleted_at,membership_status FROM people
  UNION ALL SELECT k.id,k.deleted_at,'not_member' FROM person_keys k
    WHERE k.erased_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM people p WHERE p.id=k.id);
CREATE TABLE person_retention_scope (
  operation_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES person_keys(id),
  run_at TEXT NOT NULL CHECK(julianday(run_at) IS NOT NULL),
  deleted_before TEXT NOT NULL CHECK(julianday(deleted_before) IS NOT NULL
    AND julianday(deleted_before)<=julianday(run_at,'-30 days')),
  PRIMARY KEY(operation_id,person_id)
);
CREATE TRIGGER person_retention_scope_no_update BEFORE UPDATE ON person_retention_scope
BEGIN SELECT RAISE(ABORT,'person retention scope cannot be changed'); END;
CREATE TRIGGER person_profile_retention BEFORE DELETE ON people
WHEN NOT (OLD.erased_at IS NOT NULL AND EXISTS(
  SELECT 1 FROM person_retention_scope s WHERE s.person_id=OLD.id AND OLD.deleted_at<s.deleted_before)
  AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=OLD.id
    AND m.unmerged_at IS NULL AND m.erased_at IS NULL))
BEGIN SELECT RAISE(ABORT,'person profile deletion requires retention'); END;
CREATE INDEX people_deleted_retention ON people(deleted_at,id) WHERE deleted_at IS NOT NULL;

-- Opaque cleanup keys do not authorize new personal records, including late
-- provider writes racing erasure. Origin/actor references on other live records
-- remain valid; guards check the current owner of personal data.
CREATE TRIGGER consent_records_erased_insert BEFORE INSERT ON consent_records
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER consent_records_erased_update BEFORE UPDATE ON consent_records
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER field_sources_erased_insert BEFORE INSERT ON field_sources
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER field_sources_erased_update BEFORE UPDATE ON field_sources
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER engagement_events_erased_insert BEFORE INSERT ON engagement_events
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER engagement_events_erased_update BEFORE UPDATE ON engagement_events
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER review_queue_erased_insert BEFORE INSERT ON review_queue
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.candidate_person_id,NEW.existing_person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER review_queue_erased_update BEFORE UPDATE ON review_queue
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.candidate_person_id,NEW.existing_person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER person_corrections_erased_insert BEFORE INSERT ON person_corrections
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER person_corrections_erased_update BEFORE UPDATE ON person_corrections
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER consent_withdrawals_erased_insert BEFORE INSERT ON consent_withdrawals
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER consent_withdrawals_erased_update BEFORE UPDATE ON consent_withdrawals
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER form_submissions_erased_insert BEFORE INSERT ON form_submissions
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER form_submissions_erased_update BEFORE UPDATE ON form_submissions
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER workspace_link_operations_erased_insert BEFORE INSERT ON workspace_link_operations
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER workspace_link_operations_erased_update BEFORE UPDATE ON workspace_link_operations
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER sign_in_codes_erased_insert BEFORE INSERT ON sign_in_codes
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER sign_in_codes_erased_update BEFORE UPDATE ON sign_in_codes
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER sessions_erased_insert BEFORE INSERT ON sessions
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER sessions_erased_update BEFORE UPDATE ON sessions
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER discord_link_states_erased_insert BEFORE INSERT ON discord_link_states
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER discord_link_states_erased_update BEFORE UPDATE ON discord_link_states
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER access_observations_erased_insert BEFORE INSERT ON access_observations
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER access_observations_erased_update BEFORE UPDATE ON access_observations
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER committee_assignments_erased_insert BEFORE INSERT ON committee_assignments
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER committee_assignments_erased_update BEFORE UPDATE ON committee_assignments
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER staff_administrators_erased_insert BEFORE INSERT ON staff_administrators
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER staff_administrators_erased_update BEFORE UPDATE ON staff_administrators
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER staff_form_tokens_erased_insert BEFORE INSERT ON staff_form_tokens
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.actor_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER staff_form_tokens_erased_update BEFORE UPDATE ON staff_form_tokens
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.actor_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER welcome_claims_erased_insert BEFORE INSERT ON welcome_claims
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id,NEW.actor_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER welcome_claims_erased_update BEFORE UPDATE ON welcome_claims
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.person_id,NEW.actor_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER paper_batches_erased_insert BEFORE INSERT ON paper_batches
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.actor_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER paper_batches_erased_update BEFORE UPDATE ON paper_batches
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id IN (NEW.actor_id) AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'personal records cannot be written after erasure'); END;
CREATE TRIGGER identities_erased_insert BEFORE INSERT ON identities
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id=NEW.person_id AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'identity cannot be linked after erasure'); END;
CREATE TRIGGER identities_erased_update BEFORE UPDATE ON identities
WHEN EXISTS(SELECT 1 FROM person_keys WHERE id=NEW.person_id AND erased_at IS NOT NULL)
  AND (NEW.external_email IS NOT NULL OR NEW.person_id IS NOT OLD.person_id
    OR NEW.id IS NOT OLD.id OR NEW.platform IS NOT OLD.platform OR NEW.external_id IS NOT OLD.external_id)
BEGIN SELECT RAISE(ABORT,'identity personal data cannot be restored after erasure'); END;
CREATE TRIGGER discord_profiles_erased_insert BEFORE INSERT ON discord_profiles
WHEN EXISTS(SELECT 1 FROM identities i JOIN person_keys k ON k.id=i.person_id
  WHERE i.id=NEW.identity_record_id AND k.erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'account profile cannot be written after erasure'); END;
CREATE TRIGGER discord_profiles_erased_update BEFORE UPDATE ON discord_profiles
WHEN EXISTS(SELECT 1 FROM identities i JOIN person_keys k ON k.id=i.person_id
  WHERE i.id=NEW.identity_record_id AND k.erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'account profile cannot be written after erasure'); END;
CREATE TRIGGER discord_identity_profiles_erased_insert BEFORE INSERT ON discord_identity_profiles
WHEN EXISTS(SELECT 1 FROM identities i JOIN person_keys k ON k.id=i.person_id
  WHERE i.id=NEW.identity_record_id AND k.erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'account profile cannot be written after erasure'); END;
CREATE TRIGGER discord_identity_profiles_erased_update BEFORE UPDATE ON discord_identity_profiles
WHEN EXISTS(SELECT 1 FROM identities i JOIN person_keys k ON k.id=i.person_id
  WHERE i.id=NEW.identity_record_id AND k.erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'account profile cannot be written after erasure'); END;
