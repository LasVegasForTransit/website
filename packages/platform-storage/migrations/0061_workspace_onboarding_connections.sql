-- Explicit account proofs authorize a transfer only while the provisional
-- person remains empty. The trigger checks and applies the transfer atomically.
CREATE TABLE workspace_account_connections (
 token_hash TEXT PRIMARY KEY, staff_session_hash TEXT NOT NULL,
 source_person_id TEXT NOT NULL REFERENCES person_keys(id),
 identity_record_id TEXT NOT NULL REFERENCES identities(id),
 sso_link_id TEXT REFERENCES staff_sso_links(id),
 staff_origin TEXT NOT NULL, member_origin TEXT NOT NULL, return_to TEXT NOT NULL DEFAULT '/',
 expires_at TEXT NOT NULL, member_session_hash TEXT,
 destination_person_id TEXT REFERENCES person_keys(id), consumed_at TEXT
);
CREATE TRIGGER workspace_connection_transfer BEFORE UPDATE OF consumed_at ON workspace_account_connections
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL BEGIN
 -- Keep each guard below D1's expression-depth limit. Every guard still runs
 -- inside this single trigger statement; any conflict aborts the whole transfer.
 SELECT (CASE WHEN NOT EXISTS(
  SELECT 1 FROM sessions s JOIN people p ON p.id=s.person_id
  JOIN workspace_enrollments e ON e.person_id=p.id
  WHERE s.id_hash=NEW.staff_session_hash AND s.type='staff' AND s.expires_at>NEW.consumed_at
  AND p.id=NEW.source_person_id AND p.deleted_at IS NULL AND p.membership_status='not_member'
  AND e.identity_record_id=NEW.identity_record_id AND e.provisional=1 AND e.state='active'
  AND (s.workspace_identity_id=e.identity_record_id OR (s.sso_link_id=NEW.sso_link_id
   AND EXISTS(SELECT 1 FROM staff_sso_links l WHERE l.id=s.sso_link_id AND l.person_id=p.id AND l.revoked_at IS NULL)))
 ) THEN RAISE(ABORT,'workspace_connection_conflict') END);
 SELECT (CASE WHEN NOT EXISTS(
  SELECT 1 FROM sessions m JOIN people dest ON dest.id=m.person_id JOIN person_keys k ON k.id=dest.id
  WHERE m.id_hash=NEW.member_session_hash AND m.type='member' AND m.expires_at>NEW.consumed_at
  AND dest.id=NEW.destination_person_id AND dest.id<>NEW.source_person_id
  AND dest.deleted_at IS NULL AND k.erased_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM workspace_enrollments other WHERE other.person_id=dest.id)
  AND NOT EXISTS(SELECT 1 FROM identities i WHERE i.person_id=dest.id AND i.platform='google_workspace')
  AND NOT EXISTS(SELECT 1 FROM staff_sso_links l WHERE l.person_id=dest.id)
 ) THEN RAISE(ABORT,'workspace_connection_conflict') END);
 SELECT (CASE WHEN NOT EXISTS(
  SELECT 1 FROM people p WHERE p.id=NEW.source_person_id
  AND NOT EXISTS(SELECT 1 FROM identities i WHERE i.person_id=p.id AND i.id<>NEW.identity_record_id)
  AND NOT EXISTS(SELECT 1 FROM staff_sso_links l WHERE l.person_id=p.id AND l.id IS NOT NEW.sso_link_id)
  AND p.email_verified_at IS NULL AND p.phone IS NULL AND p.zip IS NULL
  AND p.census_block IS NULL AND p.region_id IS NULL AND p.place_name IS NULL
  AND NOT EXISTS(SELECT 1 FROM consent_records c WHERE c.person_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM consent_withdrawals c WHERE c.person_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM committee_assignments c WHERE c.person_id=p.id OR c.assigned_by=p.id OR c.ended_by=p.id)
  AND NOT EXISTS(SELECT 1 FROM staff_administrators a WHERE a.person_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM person_organization_roles r WHERE r.person_id=p.id)
 ) THEN RAISE(ABORT,'workspace_connection_conflict') END);
 SELECT (CASE WHEN NOT EXISTS(
  SELECT 1 FROM people p WHERE p.id=NEW.source_person_id
  AND NOT EXISTS(SELECT 1 FROM engagement_events a WHERE a.person_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM form_submissions f WHERE f.person_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM paper_batches b WHERE b.actor_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM person_corrections c WHERE c.person_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM field_sources f WHERE f.person_id=p.id AND f.source<>'workspace_directory')
  AND NOT EXISTS(SELECT 1 FROM welcome_claims w WHERE w.person_id=p.id OR w.actor_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM person_views v WHERE v.person_id=p.id OR v.actor_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM staff_operations o WHERE o.actor_id=p.id OR o.target_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM staff_audits a WHERE (a.actor_id=p.id OR a.target_id=p.id) AND a.action IN ('identity.discord_link','identity.discord_disconnect'))
  AND NOT EXISTS(SELECT 1 FROM merges x WHERE x.surviving_person_id=p.id OR x.merged_person_id=p.id)
 ) THEN RAISE(ABORT,'workspace_connection_conflict') END);
 UPDATE identities SET person_id=NEW.destination_person_id,link_method='self_linked',updated_at=NEW.consumed_at
  WHERE id=NEW.identity_record_id AND person_id=NEW.source_person_id;
 INSERT INTO staff_team_accounts(person_id,created_at) VALUES(NEW.destination_person_id,NEW.consumed_at)
  ON CONFLICT(person_id) DO NOTHING;
 UPDATE staff_sso_links SET person_id=NEW.destination_person_id WHERE id=NEW.sso_link_id AND person_id=NEW.source_person_id;
 INSERT INTO workspace_onboarding_choices(person_id,discord_deferred_at)
  SELECT NEW.destination_person_id,discord_deferred_at FROM workspace_onboarding_choices WHERE person_id=NEW.source_person_id
  ON CONFLICT(person_id) DO UPDATE SET discord_deferred_at=coalesce(workspace_onboarding_choices.discord_deferred_at,excluded.discord_deferred_at);
 DELETE FROM workspace_onboarding_choices WHERE person_id=NEW.source_person_id;
 DELETE FROM sessions WHERE person_id=NEW.source_person_id;
 DELETE FROM staff_team_accounts WHERE person_id=NEW.source_person_id;
 UPDATE integration_outbox SET state='superseded',updated_at=NEW.consumed_at WHERE person_id=NEW.source_person_id AND state IN ('queued','retry','running');
 UPDATE people SET deleted_at=NEW.consumed_at,updated_at=NEW.consumed_at WHERE id=NEW.source_person_id;
 INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
 VALUES(lower(hex(randomblob(16))),NEW.destination_person_id,'workspace.account_connected',NEW.destination_person_id,
 json_object('provisionalPersonId',NEW.source_person_id),'workspace-connect:'||NEW.token_hash,NEW.consumed_at);
END;
CREATE TABLE staff_discord_handoffs (
 token_hash TEXT PRIMARY KEY, staff_session_hash TEXT NOT NULL,
 person_id TEXT NOT NULL REFERENCES person_keys(id),
 identity_record_id TEXT NOT NULL REFERENCES identities(id),
 staff_origin TEXT NOT NULL, member_origin TEXT NOT NULL, return_to TEXT NOT NULL,
 expires_at TEXT NOT NULL, browser_hash TEXT, approved_at TEXT, approval_hash TEXT, consumed_at TEXT,
 public_session_hash TEXT
);
CREATE TABLE workspace_onboarding_choices (
 person_id TEXT PRIMARY KEY REFERENCES person_keys(id), discord_deferred_at TEXT
);

-- A choice belongs to the proven live staff session, not an email address.
CREATE TABLE staff_onboarding_sessions (
 staff_session_hash TEXT PRIMARY KEY REFERENCES sessions(id_hash) ON DELETE CASCADE,
 person_id TEXT NOT NULL REFERENCES person_keys(id),
 identity_record_id TEXT NOT NULL REFERENCES identities(id),
 account_chosen_at TEXT NOT NULL
);
