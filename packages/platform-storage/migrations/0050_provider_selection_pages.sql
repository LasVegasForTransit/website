-- Record revocation priority while the canonical profile is still available.
UPDATE integration_outbox SET payload=json_set(payload,'$.removal',1)
WHERE kind IN ('person_reconcile','committee_reconcile') AND state IN ('queued','running','retry')
  AND json_extract(payload,'$.source')='membership_change'
  AND EXISTS(SELECT 1 FROM people p WHERE p.id=integration_outbox.person_id AND p.membership_status<>'member');
CREATE TRIGGER integration_outbox_removal_priority AFTER INSERT ON integration_outbox
WHEN NEW.kind IN ('person_reconcile','committee_reconcile')
  AND json_extract(NEW.payload,'$.source')='membership_change'
  AND EXISTS(SELECT 1 FROM people p WHERE p.id=NEW.person_id AND p.membership_status<>'member')
BEGIN UPDATE integration_outbox SET payload=json_set(payload,'$.removal',1) WHERE id=NEW.id; END;

-- Urgent removals, explicit changes and periodic drift each have an indexed lane.
CREATE INDEX integration_outbox_selection ON integration_outbox(
  CASE WHEN json_extract(payload,'$.source') IN ('person_deleted','discord_disconnect','committee.end')
    OR json_extract(payload,'$.removal')=1 THEN 0
    WHEN json_extract(payload,'$.source')='discord_drift' THEN 2 ELSE 1 END,
  next_attempt_at,id
) WHERE kind IN ('person_reconcile','committee_reconcile')
  AND state IN ('queued','running','retry');
CREATE TABLE outbox_selection_cursors (
  selector TEXT NOT NULL CHECK(selector IN ('discord','completion')),
  lane INTEGER NOT NULL CHECK(lane IN (0,1,2)),
  next_attempt_at TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  page_ids TEXT NOT NULL CHECK(json_valid(page_ids)),
  PRIMARY KEY(selector,lane)
);
