-- Revisit erasures whose earlier runner confirmed only an unsubscribe.
-- Reversible merge archives have no erasure marker and are left alone.
DELETE FROM newsletter_account_leases WHERE token IN (
  SELECT j.lease_token FROM newsletter_sync_jobs j JOIN person_keys k ON k.id=j.person_id
  WHERE k.erased_at IS NOT NULL AND j.lease_token IS NOT NULL
);

UPDATE newsletter_sync_jobs SET generation=generation+1,state='queued',
  requested_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  lease_token=NULL,lease_expires_at=NULL,last_failure=NULL
WHERE EXISTS(SELECT 1 FROM person_keys k WHERE k.id=person_id AND k.erased_at IS NOT NULL);
