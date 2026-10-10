import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
const base = {
  batchId: 'paper-fixture',
  eventId: 'citynerd-fixture',
  eventName: 'CityNerd meetup',
  eventDate: '2026-10-01',
  wordingVersion: 'paper-signup-v1',
};
const row = {
  givenName: 'New',
  familyName: 'Rider',
  email: 'paper@example.invalid',
  phone: '',
  newsletterConsent: true,
};
void test('future sheet dates cannot create attendance or membership', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  const before = f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n;
  const result = await importPaperBatch(f.db, f.actor, {
    ...base,
    eventDate: '2100-01-01',
    rows: [row],
  });
  assert.equal(result.kind, 'invalid');
  assert.ok(result.errors.eventDate);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, before);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM paper_batches').get()?.n, 0);
  f.db.raw.close();
});

void test('sheet dates follow the Pacific calendar day through UTC midnight', async () => {
  const { validatePaper } = await import('@lasvegasfortransit/platform-core/paper');
  const now = new Date('2026-10-05T02:00:00.000Z');
  assert.deepEqual(validatePaper({ ...base, eventDate: '2026-10-04', rows: [row] }, now), {});
  assert.ok(validatePaper({ ...base, eventDate: '2026-10-05', rows: [row] }, now).eventDate);
  assert.ok(validatePaper({ ...base, eventDate: '2026-02-30', rows: [row] }, now).eventDate);
});
void test('paper signup after a prior Pacific-day withdrawal can renew membership across UTC midnight', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  await f.db
    .prepare('UPDATE people SET email_verified_at=? WHERE id=?')
    .bind(new Date().toISOString(), f.survivor.id)
    .run();
  await f.people.withdrawConsent(f.survivor.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2026-10-03T03:00:00.000Z',
  });
  const result = await importPaperBatch(f.db, f.actor, {
    ...base,
    eventDate: '2026-10-03',
    rows: [{ ...row, email: f.survivor.email ?? '' }],
  });
  assert.equal(result.kind, 'ok');
  assert.equal((await f.people.getPerson(f.survivor.id))?.membership_status, 'member');
  f.db.raw.close();
});
void test('an ambiguous same-day paper signup reports that a recorded withdrawal kept membership unchanged', async () => {
  const { importPaperBatch } = await import('../src/paper-intake');
  const f = await mergeFixture();
  await f.db
    .prepare('UPDATE people SET email_verified_at=? WHERE id=?')
    .bind(new Date().toISOString(), f.survivor.id)
    .run();
  await f.people.withdrawConsent(f.survivor.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2026-10-03T13:00:00.000Z',
  });
  const result = await importPaperBatch(f.db, f.actor, {
    ...base,
    eventDate: '2026-10-03',
    rows: [{ ...row, email: f.survivor.email ?? '' }],
  });
  assert.equal(result.kind, 'ok');
  assert.equal((await f.people.getPerson(f.survivor.id))?.membership_status, 'former_member');
  assert.deepEqual(result.value.withdrawalHeldIds, [f.survivor.id]);
  f.db.raw.close();
});
