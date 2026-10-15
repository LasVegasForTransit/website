import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/platform-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { applyRosterImport } from '../platform/roster-import';
import { loadNewsletterPlan } from '@lasvegasfortransit/platform-storage/newsletter-plan';
const observedAt = '2026-10-14T12:00:00.000Z';
const current = {
  source: 'beehiiv',
  sourceId: 'sub_current_roll',
  email: 'current@example.invalid',
  beehiiv: { status: 'active' },
  newsletter: {
    state: 'active',
    givenAt: null,
    affirmative: false,
    observedAt,
    sourceCreatedAt: '2025-03-01T12:00:00.000Z',
    method: 'unknown',
  },
};
void test('current authoritative roll establishes membership without fabricated consent, history or provider activation', async () => {
  const db = memoryDb(),
    people = new PersonService(db),
    options = { runId: 'roll', now: new Date(observedAt) };
  const result = await applyRosterImport(db, [current], options);
  assert.equal(result.counts.applied, 1);
  const person = db.raw.prepare('SELECT id,membership_status FROM people').get();
  assert.ok(person);
  assert.equal(person.membership_status, 'member');
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n, 0);
  await people.recordConsent(String(person.id), {
    scope: 'event_reminders',
    source: 'account',
    method: 'checkbox',
    wordingVersion: 'fixture',
    givenAt: observedAt,
  });
  assert.equal(
    db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'member',
  );
  const plan = await loadNewsletterPlan(db, String(person.id));
  assert.ok(plan);
  assert.equal(plan.desired, 'active');
  assert.equal(plan.allowActivation, false);
  assert.equal((await applyRosterImport(db, [current], options)).counts.alreadyApplied, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM membership_roll').get()?.n, 1);
  db.raw.close();
});
void test('a later real opt-out survives a newly observed active legacy roll', async () => {
  const db = memoryDb(),
    people = new PersonService(db),
    options = { runId: 'roll', now: new Date(observedAt) };
  await applyRosterImport(db, [current], options);
  const id = String(db.raw.prepare('SELECT id FROM people').get()?.id);
  await people.withdrawConsent(id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2026-10-14T12:30:00.000Z',
  });
  const later = {
    ...current,
    newsletter: { ...current.newsletter, observedAt: '2026-10-14T13:00:00.000Z' },
  };
  const retry = await applyRosterImport(db, [later], {
    runId: 'later',
    now: new Date('2026-10-14T13:00:00.000Z'),
  });
  assert.equal(retry.counts.needsReview, 1);
  assert.notEqual(
    db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'member',
  );
  assert.equal(
    db.raw.prepare("SELECT count(*) AS n FROM consent_records WHERE scope='newsletter'").get()?.n,
    0,
  );
  const plan = await loadNewsletterPlan(db, id);
  assert.ok(plan);
  assert.equal(plan.desired, 'inactive');
  assert.equal(plan.allowActivation, false);
  db.raw.close();
});
void test('overlapping unverified original sources hold the second source without creating a second profile', async () => {
  const db = memoryDb();
  try {
    const { runDatabaseRoster } = await import('../scripts/platform/roster-database');
    const form = {
      source: 'notion_intake',
      sourceId: '00000000-0000-4000-8000-000000000001',
      email: current.email,
      newsletter: {
        state: 'active',
        affirmative: true,
        givenAt: '2025-03-01T12:00:00.000Z',
        method: 'unknown',
      },
      form: {
        fullName: 'Original form name',
        submittedAt: '2025-03-01T12:00:00.000Z',
        membershipAffirmative: null,
      },
    };
    const report = await runDatabaseRoster(db, [current, form], {
      runId: 'overlap',
      now: new Date(observedAt),
    });
    assert.equal(report.peopleCreated, 1);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM identities WHERE platform='notion_intake'").get()
        ?.n,
      0,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
    const held = db.raw
      .prepare("SELECT person_id,suggested_person_id FROM roster_import_records WHERE state='held'")
      .get();
    assert.equal(held?.person_id, null);
    assert.equal(held.suggested_person_id, db.raw.prepare('SELECT id FROM people').get()?.id);
  } finally {
    db.raw.close();
  }
});
void test('database report counts recognized current roll without reporting invented consent', async () => {
  const db = memoryDb();
  try {
    const { runDatabaseRoster, printRosterReport } =
      await import('../scripts/platform/roster-database');
    const report = await runDatabaseRoster(db, [current], {
      runId: 'roll-report',
      now: new Date(observedAt),
    });
    assert.equal(report.currentRollObservations, 1);
    assert.equal(report.membersRecognized, 1);
    assert.equal(report.consentRecordsCreated, 0);
    assert.match(printRosterReport(report, true), /Current roll observations recorded: 1/);
    assert.match(printRosterReport(report, true), /Members recognized from the current roll: 1/);
    const repeat = await runDatabaseRoster(db, [current], {
      runId: 'roll-report',
      now: new Date(observedAt),
    });
    assert.equal(repeat.currentRollObservations, 0);
    assert.equal(repeat.membersRecognized, 0);
  } finally {
    db.raw.close();
  }
});
async function overlappingSources(originalChoice = true) {
  const { mergeFixture } =
    await import('../../../packages/platform-storage/tests/support/merge-fixture');
  const f = await mergeFixture();
  const form = {
    source: 'notion_intake',
    sourceId: '00000000-0000-4000-8000-000000000002',
    email: current.email,
    newsletter: originalChoice
      ? {
          state: 'active',
          affirmative: true,
          givenAt: '2025-03-01T12:00:00.000Z',
          method: 'unknown',
          wording: 'Finishing this form will sign you up for our email newsletter. Is this okay?',
          answer: 'Yes',
        }
      : { state: 'unknown', givenAt: null, affirmative: false, answer: null },
    form: {
      fullName: 'Original form name',
      submittedAt: '2025-03-01T12:00:00.000Z',
      membershipAffirmative: null,
    },
  };
  const records = [current, form],
    options = { runId: 'real-shape', now: new Date(observedAt) };
  const result = await applyRosterImport(f.db, records, options);
  const personId = result.records[0]?.personId;
  assert.ok(personId);
  const receipt = f.db.raw
    .prepare("SELECT id,evidence_hash FROM roster_import_records WHERE state='held'")
    .get();
  assert.ok(receipt);
  const person = await f.people.getExactPerson(personId);
  assert.ok(person);
  const { confirmRosterSource } =
    await import('../../../packages/platform-storage/src/roster-import-resolve');
  const confirmed = await confirmRosterSource(f.db, f.actor, {
    recordId: String(receipt.id),
    personId,
    evidenceHash: String(receipt.evidence_hash),
    personUpdatedAt: person.updated_at,
    operationId: 'confirm-real-shape',
  });
  assert.equal(confirmed.kind, 'applied');
  return { f, records, options, personId };
}
void test('explicit source confirmation and reviewed retry preserve original history with a single profile', async (context) => {
  const { f, records, options, personId } = await overlappingSources();
  context.after(() => f.db.raw.close());
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM consent_records WHERE person_id=?').get(personId)
      ?.n,
    0,
  );
  const result = await applyRosterImport(f.db, records, { ...options, retryHeld: true });
  assert.equal(result.counts.applied, 1);
  assert.equal(result.counts.alreadyApplied, 1);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM people WHERE email=?').get(current.email)?.n,
    1,
  );
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT count(*) AS n FROM identities WHERE person_id=? AND platform IN ('beehiiv','notion_intake')",
      )
      .get(personId)?.n,
    2,
  );
  const consent = f.db.raw
    .prepare('SELECT given_at,method,wording_version FROM consent_records WHERE person_id=?')
    .get(personId);
  assert.equal(consent?.given_at, '2025-03-01T12:00:00.000Z');
  assert.equal(consent.method, 'unknown');
  assert.equal(consent.wording_version, null);
  assert.equal(
    f.db.raw
      .prepare("SELECT count(*) AS n FROM engagement_events WHERE person_id=? AND type='joined'")
      .get(personId)?.n,
    0,
  );
  assert.equal(
    (await applyRosterImport(f.db, records, { ...options, retryHeld: true })).counts.alreadyApplied,
    2,
  );
});
void test('source confirmation cannot override a newer actual mailing choice when historical evidence is retried', async (context) => {
  const { f, records, options, personId } = await overlappingSources();
  context.after(() => f.db.raw.close());
  await f.people.withdrawConsent(personId, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2026-10-14T12:30:00.000Z',
  });
  const result = await applyRosterImport(f.db, records, {
    ...options,
    now: new Date('2026-10-14T13:00:00.000Z'),
    retryHeld: true,
  });
  assert.equal(result.counts.conflicts, 1);
  assert.equal((await f.people.getExactPerson(personId))?.membership_status, 'former_member');
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM consent_records WHERE person_id=?').get(personId)
      ?.n,
    0,
  );
  const plan = await loadNewsletterPlan(f.db, personId);
  assert.ok(plan);
  assert.equal(plan.desired, 'inactive');
  assert.equal(plan.allowActivation, false);
});

void test('confirmed form response with absent historical answer adds no missing-history task for a recognized current member', async (context) => {
  const { f, records, options, personId } = await overlappingSources(false);
  context.after(() => f.db.raw.close());
  const result = await applyRosterImport(f.db, records, { ...options, retryHeld: true });
  assert.equal(result.counts.applied, 1);
  assert.equal(result.counts.unresolved, 0);
  assert.equal(result.counts.needsReview, 0);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM consent_records WHERE person_id=?').get(personId)
      ?.n,
    0,
  );
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT count(*) AS n FROM engagement_events WHERE person_id=? AND type IN ('joined','subscribed')",
      )
      .get(personId)?.n,
    0,
  );
  const response = f.db.raw
    .prepare(
      "SELECT occurred_at,details FROM engagement_events WHERE person_id=? AND type='form_response'",
    )
    .get(personId);
  assert.equal(response?.occurred_at, '2025-03-01T12:00:00.000Z');
  assert.match(String(response.details), /Original form name/);
  assert.equal(
    f.db.raw.prepare("SELECT state FROM roster_import_records WHERE source='notion_intake'").get()
      ?.state,
    'applied',
  );
  assert.equal((await f.people.getExactPerson(personId))?.membership_status, 'member');
  assert.equal(
    (await applyRosterImport(f.db, records, { ...options, retryHeld: true })).counts.alreadyApplied,
    2,
  );
});
