import assert from 'node:assert/strict';
import test from 'node:test';
import { membershipRollFixture } from './support/membership-roll-fixture';
import {
  claimNewsletterJob,
  pendingNewsletterPeople,
  releaseNewsletterLease,
} from '../src/newsletter-sync-store';

void test('unknown membership waits for review instead of retrying every minute', async () => {
  const { db, person, input, roll } = await membershipRollFixture();
  try {
    assert.equal(
      await roll.recordCurrentMembershipRoll(db, { ...input, status: 'unknown' }),
      'needs_review',
    );
    const now = new Date(Date.now() + 1000);
    assert.equal(await claimNewsletterJob(db, person.id, 'pub_fixture', now), null);
    assert.deepEqual(
      {
        ...db.raw
          .prepare('SELECT state,last_failure FROM newsletter_sync_jobs WHERE person_id=?')
          .get(person.id),
      },
      { state: 'needs_review', last_failure: 'consent_evidence_needed' },
    );
    assert.deepEqual(await pendingNewsletterPeople(db, new Date(now.getTime() + 86_400_000)), []);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM newsletter_account_leases').get()?.n, 0);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});

void test('new membership evidence resumes a review-held newsletter job', async () => {
  const { db, person, input, roll } = await membershipRollFixture();
  try {
    await roll.recordCurrentMembershipRoll(db, { ...input, status: 'unknown' });
    const now = new Date(Date.now() + 1000);
    assert.equal(await claimNewsletterJob(db, person.id, 'pub_fixture', now), null);
    assert.equal(
      db.raw.prepare('SELECT state FROM newsletter_sync_jobs WHERE person_id=?').get(person.id)
        ?.state,
      'needs_review',
    );
    assert.equal(
      await roll.recordCurrentMembershipRoll(db, {
        ...input,
        observedAt: '2026-10-14T11:00:00.000Z',
      }),
      'applied',
    );
    assert.deepEqual(await pendingNewsletterPeople(db, now), [person.id]);
    const lease = await claimNewsletterJob(db, person.id, 'pub_fixture', now);
    assert.ok(lease);
    await releaseNewsletterLease(db, lease);
  } finally {
    db.raw.close();
  }
});
