-- A durable wake survives Worker restarts and shares the input transaction.
CREATE TABLE scheduled_work_signals (
  name TEXT PRIMARY KEY CHECK(name IN ('providers','profiles','inactive','records')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  next_run_at TEXT NOT NULL,
  configuration TEXT NOT NULL DEFAULT ''
);
CREATE INDEX scheduled_work_due ON scheduled_work_signals(next_run_at);
INSERT INTO scheduled_work_signals(name,next_run_at) VALUES
  ('providers','1970-01-01T00:00:00.000Z'),
  ('profiles','1970-01-01T00:00:00.000Z'),
  ('inactive','1970-01-01T00:00:00.000Z'),
  ('records','1970-01-01T00:00:00.000Z');
CREATE INDEX newsletter_account_lease_expiry ON newsletter_account_leases(expires_at);
CREATE INDEX google_check_failure_age ON google_group_check_failures(started_at);
CREATE INDEX roster_unassigned_retention ON roster_import_records(recorded_at,id)
  WHERE person_id IS NULL AND evidence IS NOT NULL;
CREATE TRIGGER scheduled_wake_providers_0 AFTER INSERT ON integration_outbox
WHEN NEW.state IN ('queued','running','retry')
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_1 AFTER UPDATE OF state,next_attempt_at,generation ON integration_outbox
WHEN NEW.state IN ('queued','running','retry') AND (OLD.state IS NOT NEW.state OR OLD.next_attempt_at IS NOT NEW.next_attempt_at OR OLD.generation IS NOT NEW.generation)
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_2 AFTER INSERT ON newsletter_sync_jobs
WHEN NEW.state IN ('queued','running','retry')
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_3 AFTER UPDATE OF state,next_attempt_at,generation ON newsletter_sync_jobs
WHEN NEW.state IN ('queued','running','retry') AND (OLD.state IS NOT NEW.state OR OLD.next_attempt_at IS NOT NEW.next_attempt_at OR OLD.generation IS NOT NEW.generation)
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_4 AFTER INSERT ON newsletter_inbound_events
WHEN NEW.state='pending'
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_5 AFTER UPDATE OF state,occurred_at ON newsletter_inbound_events
WHEN NEW.state='pending' AND (OLD.state IS NOT NEW.state OR OLD.occurred_at IS NOT NEW.occurred_at)
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_6 AFTER INSERT ON newsletter_poll_choices
WHEN NEW.state IN ('pending','needs_review')
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_7 AFTER UPDATE OF revision,state,observed_at ON newsletter_poll_choices
WHEN NEW.state IN ('pending','needs_review') AND (OLD.revision IS NOT NEW.revision OR OLD.state IS NOT NEW.state OR OLD.observed_at IS NOT NEW.observed_at)
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_8 AFTER INSERT ON provider_operation_receipts
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_9 AFTER UPDATE OF state,observed_at,expires_at ON provider_operation_receipts
WHEN OLD.state IS NOT NEW.state OR OLD.observed_at IS NOT NEW.observed_at OR OLD.expires_at IS NOT NEW.expires_at
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_10 AFTER INSERT ON identities
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_11 AFTER UPDATE OF person_id,platform,external_id,link_method ON identities
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_12 AFTER DELETE ON identities
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_providers_13 AFTER INSERT ON discord_disconnects
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_profiles_14 AFTER INSERT ON people
WHEN NEW.deleted_at IS NOT NULL
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='profiles';
END;
CREATE TRIGGER scheduled_wake_profiles_15 AFTER UPDATE OF deleted_at,erased_at ON people
WHEN OLD.deleted_at IS NOT NEW.deleted_at OR OLD.erased_at IS NOT NEW.erased_at
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='profiles';
END;
CREATE TRIGGER scheduled_wake_profiles_16 AFTER INSERT ON merges
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='profiles';
END;
CREATE TRIGGER scheduled_wake_profiles_17 AFTER UPDATE OF unmerged_at,erased_at ON merges
WHEN OLD.unmerged_at IS NOT NEW.unmerged_at OR OLD.erased_at IS NOT NEW.erased_at
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='profiles';
END;
CREATE TRIGGER scheduled_wake_profiles_18 AFTER DELETE ON merges
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='profiles';
END;
CREATE INDEX newsletter_sync_effective_due ON newsletter_sync_jobs(
  state,max(next_attempt_at,coalesce(lease_expires_at,next_attempt_at)),requested_at,person_id
);
CREATE TRIGGER scheduled_wake_provider_backoffs_insert AFTER INSERT ON provider_backoffs
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_provider_backoffs_update AFTER UPDATE OF expires_at ON provider_backoffs
WHEN OLD.expires_at IS NOT NEW.expires_at
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_provider_backoffs_delete AFTER DELETE ON provider_backoffs
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_newsletter_provider_backoffs_insert AFTER INSERT ON newsletter_provider_backoffs
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_newsletter_provider_backoffs_update AFTER UPDATE OF until_at ON newsletter_provider_backoffs
WHEN OLD.until_at IS NOT NEW.until_at
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_newsletter_provider_backoffs_delete AFTER DELETE ON newsletter_provider_backoffs
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_provider_account_leases_insert AFTER INSERT ON provider_account_leases
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_provider_account_leases_update AFTER UPDATE OF expires_at ON provider_account_leases
WHEN OLD.expires_at IS NOT NEW.expires_at
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_provider_account_leases_delete AFTER DELETE ON provider_account_leases
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_newsletter_account_leases_insert AFTER INSERT ON newsletter_account_leases
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_newsletter_account_leases_update AFTER UPDATE OF expires_at ON newsletter_account_leases
WHEN OLD.expires_at IS NOT NEW.expires_at
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_newsletter_account_leases_delete AFTER DELETE ON newsletter_account_leases
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_provider_scan_checkpoints_insert AFTER INSERT ON provider_scan_checkpoints
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_provider_scan_checkpoints_update AFTER UPDATE OF next_scan_at,in_progress,last_completed_at,lease_expires_at ON provider_scan_checkpoints
WHEN OLD.next_scan_at IS NOT NEW.next_scan_at OR OLD.in_progress IS NOT NEW.in_progress OR OLD.last_completed_at IS NOT NEW.last_completed_at OR OLD.lease_expires_at IS NOT NEW.lease_expires_at
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_provider_scan_checkpoints_delete AFTER DELETE ON provider_scan_checkpoints
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_beehiiv_poll_checkpoints_insert AFTER INSERT ON beehiiv_poll_checkpoints
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_beehiiv_poll_checkpoints_update AFTER UPDATE OF next_scan_at,next_attempt_at,in_progress,lease_expires_at ON beehiiv_poll_checkpoints
WHEN OLD.next_scan_at IS NOT NEW.next_scan_at OR OLD.next_attempt_at IS NOT NEW.next_attempt_at OR OLD.in_progress IS NOT NEW.in_progress OR OLD.lease_expires_at IS NOT NEW.lease_expires_at
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_beehiiv_poll_checkpoints_delete AFTER DELETE ON beehiiv_poll_checkpoints
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_discord_disconnects_insert AFTER INSERT ON discord_disconnects
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_discord_disconnects_update AFTER UPDATE OF identity_record_id,requested_at ON discord_disconnects
WHEN OLD.identity_record_id IS NOT NEW.identity_record_id OR OLD.requested_at IS NOT NEW.requested_at
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE TRIGGER scheduled_wake_discord_disconnects_delete AFTER DELETE ON discord_disconnects
WHEN 1
BEGIN
  UPDATE scheduled_work_signals SET revision=revision+1,next_run_at='1970-01-01T00:00:00.000Z'
    WHERE name='providers';
END;
CREATE INDEX provider_receipt_expiry ON provider_operation_receipts(expires_at);
CREATE INDEX provider_receipt_freshness ON provider_operation_receipts(provider,observed_at);
CREATE INDEX newsletter_inbound_effective_due ON newsletter_inbound_events(state,julianday(occurred_at));
CREATE INDEX identities_provider_people ON identities(platform,person_id,link_method);
CREATE INDEX integration_outbox_active_due ON integration_outbox(next_attempt_at)
  WHERE kind IN ('person_reconcile','committee_reconcile') AND state IN ('queued','running','retry');
CREATE INDEX newsletter_inbound_dispatch ON newsletter_inbound_events(state,publication_id,julianday(occurred_at),received_at,id);
ALTER TABLE outbox_selection_cursors ADD COLUMN sweep_next_attempt_at TEXT NOT NULL DEFAULT '';
ALTER TABLE outbox_selection_cursors ADD COLUMN sweep_operation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE outbox_selection_cursors ADD COLUMN sweep_wrapped INTEGER NOT NULL DEFAULT 0 CHECK(sweep_wrapped IN (0,1));
ALTER TABLE outbox_selection_cursors ADD COLUMN sweep_complete INTEGER NOT NULL DEFAULT 1 CHECK(sweep_complete IN (0,1));
