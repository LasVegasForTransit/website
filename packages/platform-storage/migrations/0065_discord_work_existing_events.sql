-- Preserve the reconciliation decision independently of the stable request ID.
ALTER TABLE discord_work_requests ADD COLUMN existing_event INTEGER NOT NULL DEFAULT 0 CHECK(existing_event IN (0,1));
UPDATE discord_work_requests SET existing_event=1 WHERE id LIKE 'existing-%';
