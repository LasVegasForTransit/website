import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { loadActor } from '../src/staff-roles';
import { queueForReview } from '../src/matching';
async function fixture() {
  const loaded = await import('../src/reviews').catch(() => null);
  assert.ok(loaded, 'duplicate review needs a current administrator workflow');
  const db = memoryDb();
  const people = new PersonService(db);
  const member = async (name: string) =>
    (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { given_name: name, email: `${name}@example.invalid` },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
        },
      })
    ).person;
  const admin = await member('admin');
  db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(admin.id, 'fixture', new Date().toISOString());
  const candidate = await member('candidate');
  const existing = await member('existing');
  const actor = await loadActor(db, admin.id);
  assert.ok(actor);
  await queueForReview(
    db,
    candidate.id,
    {
      kind: 'new',
      withholdEmail: false,
      details: null,
      review: [
        { existingPersonId: existing.id, reason: 'same phone' },
        { existingPersonId: existing.id, reason: 'same name and ZIP code' },
      ],
    },
    new Date().toISOString(),
  );
  const row = db.raw.prepare('SELECT id FROM review_queue LIMIT 1').get();
  assert.ok(row);
  return { ...loaded, db, actor, candidate, existing, id: String(row.id) };
}
void test('review listing is paginated and administrator-only, and direct comparisons audit both person reads', async () => {
  const { db, actor, listReviews, reviewItem, id, candidate, existing } = await fixture();
  const page = await listReviews(db, actor, { limit: 1 });
  assert.equal(page.items.length, 1);
  assert.ok(page.nextCursor);
  assert.equal(
    (await listReviews(db, actor, { cursor: page.nextCursor, limit: 1 })).items.length,
    1,
  );
  const item = await reviewItem(db, actor, id);
  assert.ok(item);
  assert.equal(item.candidate.person.id, candidate.id);
  assert.equal(item.existing.person.id, existing.id);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_views').get()?.n, 2);
  db.raw
    .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
    .run(actor.personId);
  await assert.rejects(listReviews(db, actor, {}), /access/);
  assert.equal(await reviewItem(db, actor, id), null);
});
void test('keeping separate resolves the whole pair once, records the decision, and prevents new reasons from requeueing it', async () => {
  const { db, actor, keepSeparate, id, candidate, existing, listReviews } = await fixture();
  const input = { operationId: 'keep', note: 'Confirmed different people.' };
  assert.equal((await keepSeparate(db, actor, id, input)).kind, 'ok');
  assert.equal((await listReviews(db, actor, {})).items.length, 0);
  assert.equal(
    db.raw
      .prepare(
        "SELECT count(*) AS n FROM review_queue WHERE resolution='kept_separate' AND resolved_by=?",
      )
      .get(actor.personId)?.n,
    2,
  );
  assert.equal((await keepSeparate(db, actor, id, input)).kind, 'ok');
  assert.equal(
    (await keepSeparate(db, actor, id, { ...input, note: 'Different payload' })).kind,
    'conflict',
  );
  assert.equal(
    db.raw
      .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='review.keep_separate'")
      .get()?.n,
    1,
  );
  assert.equal(
    db.raw
      .prepare("SELECT count(*) AS n FROM engagement_events WHERE type='duplicate_reviewed'")
      .get()?.n,
    2,
  );
  await queueForReview(
    db,
    existing.id,
    {
      kind: 'new',
      withholdEmail: false,
      details: null,
      review: [{ existingPersonId: candidate.id, reason: 'same email, unverified' }],
    },
    new Date().toISOString(),
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM review_queue').get()?.n, 2);
});
void test('a keep-separate decision rolls back entirely when recording history fails', async () => {
  const { db, actor, keepSeparate, id } = await fixture();
  db.raw.exec(
    "CREATE TRIGGER fail_review BEFORE INSERT ON staff_audits WHEN NEW.action='review.keep_separate' BEGIN SELECT RAISE(ABORT,'fixture_review_failure'); END",
  );
  await assert.rejects(
    keepSeparate(db, actor, id, { operationId: 'failed', note: '' }),
    /fixture_review_failure/,
  );
  assert.equal(
    db.raw.prepare('SELECT count(*) AS n FROM review_queue WHERE resolved_at IS NULL').get()?.n,
    2,
  );
  assert.equal(
    db.raw.prepare("SELECT 1 FROM staff_operations WHERE operation_id='failed'").get(),
    undefined,
  );
  assert.equal(
    db.raw
      .prepare("SELECT count(*) AS n FROM engagement_events WHERE type='duplicate_reviewed'")
      .get()?.n,
    0,
  );
});
