import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, applyMigrations } from './support/db';

void test('the privacy upgrade clears older erased history and backfills honest opaque receipts and Google review', () => {
  const db = memoryDb('0040_newsletter_poll_choices.sql');
  try {
    db.raw
      .exec(`INSERT INTO people(id,created_at,updated_at) VALUES('legacy','2020-01-01','2020-01-01');
      INSERT INTO consent_records(id,person_id,scope,given_at,source,method,wording_version,created_at,updated_at)
        VALUES('old-consent','legacy','volunteer_contact','2020-01-01','paper','checkbox','v1','2020-01-01','2020-01-01');
      INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
        VALUES('google-identity','legacy','google_workspace','google-subject','2020-01-01','self_linked','2020-01-01','2020-01-01');
      UPDATE people SET deleted_at='2026-10-01T00:00:00.000Z',erased_at='2026-10-01T00:00:00.000Z' WHERE id='legacy';`);
    const pending = db.raw.prepare('SELECT * FROM integration_outbox').all();
    applyMigrations(db.raw);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
    const receipt = db.raw.prepare('SELECT * FROM person_deletion_log').get();
    assert.ok(receipt);
    assert.equal(receipt.requested_by, 'retention');
    assert.equal(receipt.reason, 'legacy');
    assert.equal(receipt.completed_at, '2026-10-01T00:00:00.000Z');
    assert.equal(
      db.raw.prepare('SELECT reason FROM workspace_offboarding_queue').get()?.reason,
      'erased',
    );
    assert.deepEqual(db.raw.prepare('SELECT * FROM integration_outbox').all(), pending);
    assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.raw.close();
  }
});
