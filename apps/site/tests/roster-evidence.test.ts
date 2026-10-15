import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/platform-db';
import { applyRosterImport } from '../platform/roster-import';

const now = new Date('2026-10-14T12:00:00.000Z');
const base = {
  source: 'beehiiv',
  sourceId: 'sub_evidence',
  email: 'evidence@example.invalid',
  newsletter: {
    state: 'active',
    givenAt: '2026-03-01T12:00:00.000Z',
    affirmative: true,
    method: 'checkbox',
    wordingVersion: 'original-form-v1',
    answer: 'Yes, send me updates.',
  },
};

void test('import preserves original method and wording, rather than relabeling confirmed evidence', async () => {
  const db = memoryDb();
  await applyRosterImport(db, [base], { runId: 'evidence', now });
  const row = db.raw.prepare('SELECT method,wording_version FROM consent_records').get();
  assert.equal(row?.method, 'checkbox');
  assert.equal(row.wording_version, 'original-form-v1');
  db.raw.close();
});

void test('provider creation and observed inactivity cannot invent a choice; held inputs remain reviewable and replay safe', async () => {
  const db = memoryDb();
  const input = {
    ...base,
    newsletter: {
      state: 'withdrawn',
      givenAt: base.newsletter.givenAt,
      affirmative: false,
      observedAt: '2026-10-13T12:00:00.000Z',
      withdrawnTimeBasis: 'observed',
    },
  };
  await applyRosterImport(db, [input], { runId: 'held', now });
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  assert.equal(
    db.raw.prepare("SELECT count(*) AS n FROM roster_import_records WHERE state='held'").get()?.n,
    1,
  );
  const retry = await applyRosterImport(db, [input], { runId: 'retry', now });
  assert.equal(retry.counts.alreadyApplied, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM roster_import_records').get()?.n, 1);
  db.raw.close();
});

void test('Notion response preserves original answer, referral and unlinked Discord name without asserting membership', async () => {
  const db = memoryDb();
  const input = {
    source: 'notion_intake',
    sourceId: 'page_form',
    email: 'form@example.invalid',
    newsletter: { state: 'unknown', givenAt: null },
    form: {
      submittedAt: '2026-03-01T12:00:00.000Z',
      membershipAffirmative: null,
      affirmativeAnswer: null,
      discordUsername: 'transit_rider',
      referral: 'CityNerd event',
    },
  };
  await applyRosterImport(db, [input], { runId: 'form', now });
  const event = db.raw.prepare('SELECT type,occurred_at,details FROM engagement_events').get();
  assert.equal(event?.type, 'form_response');
  assert.equal(event.occurred_at, input.form.submittedAt);
  const details = JSON.parse(String(event.details)) as { form: unknown };
  assert.deepEqual(details.form, {
    ...input.form,
    sourceSubmittedAt: null,
    fullName: null,
    source: null,
    originalResponseTimestamp: null,
    originalResponseTimeZone: null,
    submissionMinute: null,
  });
  assert.equal(
    db.raw.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").get()?.n,
    0,
  );
  assert.equal(
    db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'not_member',
  );
  db.raw.close();
});

void test('erasure removes retained import evidence and retry cannot recreate the erased source identity', async () => {
  const db = memoryDb();
  const { PersonService } = await import('@lasvegasfortransit/platform-storage/person-service');
  await applyRosterImport(db, [base], { runId: 'erase', now });
  const id = String(db.raw.prepare('SELECT id FROM people').get()?.id);
  await new PersonService(db).deletePerson(id);
  assert.equal(
    db.raw
      .prepare('SELECT count(*) AS n FROM roster_import_records WHERE evidence IS NOT NULL')
      .get()?.n,
    0,
  );
  await applyRosterImport(db, [base], { runId: 'erased-retry', now });
  assert.equal(
    db.raw.prepare('SELECT count(*) AS n FROM people WHERE erased_at IS NULL').get()?.n,
    0,
  );
  db.raw.close();
});
void test('erasing an unlinked suggested match clears evidence even after their email changed and blocks a changed-source replay', async () => {
  const db = memoryDb();
  try {
    const { PersonService } = await import('@lasvegasfortransit/platform-storage/person-service');
    const people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'staff',
      fields: { email: base.email },
    });
    await applyRosterImport(db, [base], { runId: 'suggestion', now });
    const held = db.raw
      .prepare('SELECT person_id,suggested_person_id FROM roster_import_records')
      .get();
    assert.equal(held?.person_id, null);
    assert.equal(held.suggested_person_id, person.id);
    await people.updateFields(person.id, {
      source: 'staff',
      fields: { email: 'changed@example.invalid' },
    });
    await people.deletePerson(person.id);
    assert.equal(
      db.raw.prepare('SELECT evidence FROM roster_import_records').get()?.evidence,
      null,
    );
    await applyRosterImport(db, [{ ...base, givenName: 'New source name' }], {
      runId: 'changed-replay',
      now,
    });
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM people WHERE erased_at IS NULL').get()?.n,
      0,
    );
    assert.equal(
      db.raw
        .prepare('SELECT count(*) AS n FROM roster_import_records WHERE evidence IS NOT NULL')
        .get()?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});
