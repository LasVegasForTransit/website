import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { bootstrapStaffAdmin, loadActor } from '../src/staff-roles';
import { CommitteeService } from '../src/committees';
import { linkWorkspaceIdentity } from '../src/workspace-link';
import { memoryDb } from './support/db';
const NOW = new Date('2026-10-04T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
async function fixture() {
  const loaded = await import('../src/welcome').catch(() => null);
  assert.ok(loaded, 'welcome work requires an atomic, scoped claim service');
  const db = memoryDb();
  const people = new PersonService(db);
  const member = async (name: string, date = daysAgo(1)) => {
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { given_name: name, email: `${name}@example.invalid`, phone: '7025550100' },
    });
    await people.recordConsent(person.id, {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: date,
    });
    await people.recordEngagement(person.id, {
      type: 'joined',
      occurredAt: date,
      source: 'join_form',
      details: { interests: ['events'] },
    });
    return person;
  };
  const admin = await member('admin', daysAgo(90));
  await linkWorkspaceIdentity(db, {
    workspace: {
      subject: 'google-admin',
      email: 'admin@lasvegasfortransit.org',
      givenName: null,
      familyName: null,
    },
    personId: admin.id,
    method: 'self_linked',
    operationId: 'link',
  });
  await bootstrapStaffAdmin(db, {
    presidentPersonId: admin.id,
    workspaceSubject: 'google-admin',
    performedBy: 'fixture',
    operationId: 'bootstrap',
  });
  const lead = await member('lead', daysAgo(90));
  const committees = new CommitteeService(db);
  const assignment = await committees.assign({
    personId: lead.id,
    committeeId: 'events',
    role: 'lead',
    actorId: admin.id,
    operationId: 'lead',
  });
  assert.equal(assignment.kind, 'ok');
  db.raw.prepare("UPDATE committees SET interest_ids='[\"events\"]' WHERE id='events'").run();
  const adminActor = await loadActor(db, admin.id),
    leadActor = await loadActor(db, lead.id);
  assert.ok(adminActor);
  assert.ok(leadActor);
  return {
    db,
    people,
    member,
    admin,
    lead,
    adminActor,
    leadActor,
    committees,
    assignment: assignment.value,
    service: new loaded.WelcomeService(db),
  };
}
void test('welcome queue includes the exact 60-day boundary, orders overdue first, and never lists contact data', async () => {
  const f = await fixture();
  const boundary = await f.member('boundary', daysAgo(60));
  await f.member('older', new Date(Date.parse(daysAgo(60)) - 1).toISOString());
  const overdue = await f.member('overdue', daysAgo(7));
  const recent = await f.member('recent', daysAgo(1));
  const future = await f.member('future', new Date(NOW.getTime() + 1).toISOString());
  const queue = await f.service.list(f.adminActor, { now: NOW });
  assert.deepEqual(
    queue.items.map((row) => row.personId),
    [boundary.id, overdue.id, recent.id],
  );
  assert.deepEqual(
    queue.items.map((row) => row.overdue),
    [true, true, false],
  );
  assert.equal(JSON.stringify(queue).includes('@example.invalid'), false);
  assert.equal(JSON.stringify(queue).includes('7025550100'), false);
  assert.equal(
    queue.items.some((row) => row.personId === future.id),
    false,
  );
  const first = await f.service.list(f.adminActor, { now: NOW, limit: 1 });
  assert.ok(first.nextCursor);
  const next = await f.service.list(f.adminActor, { now: NOW, cursor: first.nextCursor, limit: 1 });
  assert.equal(next.items[0]?.personId, overdue.id);
  await assert.rejects(() => f.service.list(f.adminActor, { now: NOW, cursor: 'garbage' }));
  f.db.raw.close();
});
void test('a claimed member stays actionable through claim expiry after aging past 60 days, and failed completion rolls back every write', async () => {
  const f = await fixture();
  const person = await f.member('boundary-claim', daysAgo(60));
  assert.equal(
    (await f.service.claim(f.adminActor, person.id, { operationId: 'claim', now: NOW })).kind,
    'ok',
  );
  const tomorrow = new Date(NOW.getTime() + 86_400_000);
  assert.equal((await f.service.entry(f.adminActor, person.id, tomorrow))?.personId, person.id);
  assert.equal(await f.service.entry(f.leadActor, person.id, tomorrow), null);
  f.db.raw.exec(
    "CREATE TRIGGER fixture_reject_welcome BEFORE INSERT ON engagement_events WHEN NEW.type='welcomed' BEGIN SELECT RAISE(ABORT,'fixture rejection'); END;",
  );
  const input = { operationId: 'complete', method: 'email' as const, note: 'Hello', now: tomorrow };
  await assert.rejects(
    () => f.service.complete(f.adminActor, person.id, input),
    /fixture rejection/,
  );
  assert.ok(await f.service.contact(f.adminActor, person.id, tomorrow));
  assert.equal(
    f.db.raw
      .prepare("SELECT count(*) AS n FROM staff_operations WHERE operation_id='complete'")
      .get()?.n,
    0,
  );
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='welcome.complete'").get()
      ?.n,
    0,
  );
  f.db.raw.exec('DROP TRIGGER fixture_reject_welcome');
  assert.equal((await f.service.complete(f.adminActor, person.id, input)).kind, 'ok');
  f.db.raw.close();
});
void test('competing claims have one winner; only the current claimant sees contact, and seven-day expiry allows another claimant', async () => {
  const f = await fixture();
  const person = await f.member('claimable');
  const outcomes = await Promise.all([
    f.service.claim(f.adminActor, person.id, { operationId: 'admin-claim', now: NOW }),
    f.service.claim(f.leadActor, person.id, { operationId: 'lead-claim', now: NOW }),
  ]);
  assert.equal(outcomes.filter((result) => result.kind === 'ok').length, 1);
  const adminWon = outcomes[0].kind === 'ok';
  const winner = adminWon ? f.adminActor : f.leadActor,
    loser = adminWon ? f.leadActor : f.adminActor;
  assert.equal((await f.service.contact(winner, person.id, NOW))?.email, person.email);
  assert.equal(await f.service.contact(loser, person.id, NOW), null);
  const expires = new Date(NOW.getTime() + 7 * 86_400_000);
  assert.equal(await f.service.contact(winner, person.id, expires), null);
  assert.equal(
    (await f.service.claim(loser, person.id, { operationId: 'after-expiry', now: expires })).kind,
    'ok',
  );
  assert.equal(await f.service.contact(winner, person.id, expires), null);
  assert.equal(
    (await f.service.release(winner, person.id, { operationId: 'wrong-release', now: expires }))
      .kind,
    'conflict',
  );
  assert.equal(
    (await f.service.release(loser, person.id, { operationId: 'release', now: expires })).kind,
    'ok',
  );
  assert.equal(
    (await f.service.release(loser, person.id, { operationId: 'release', now: expires })).kind,
    'ok',
  );
  assert.equal(await f.service.contact(loser, person.id, expires), null);
  f.db.raw.close();
});
void test('claims do not broaden profile access and cannot preserve contact after lead, mapping, or membership removal', async () => {
  const f = await fixture();
  const person = await f.member('unassigned');
  const { getStaffPerson } = await import('../src/staff-people');
  assert.equal(await getStaffPerson(f.db, f.leadActor, person.id), null);
  assert.equal(
    (await f.service.claim(f.leadActor, person.id, { operationId: 'claim', now: NOW })).kind,
    'ok',
  );
  assert.ok(await f.service.contact(f.leadActor, person.id, NOW));
  f.db.raw.prepare("UPDATE committees SET interest_ids='[]' WHERE id='events'").run();
  assert.equal(await f.service.contact(f.leadActor, person.id, NOW), null);
  assert.equal(
    (
      await f.service.complete(f.leadActor, person.id, {
        operationId: 'removed-map',
        method: 'email',
        note: 'Hello',
        now: NOW,
      })
    ).kind,
    'forbidden',
  );
  f.db.raw.prepare("UPDATE committees SET interest_ids='[\"events\"]' WHERE id='events'").run();
  await f.committees.endAssignment(f.assignment.id, 'stepped_back', f.admin.id, 'end');
  assert.equal(await f.service.contact(f.leadActor, person.id, NOW), null);
  assert.equal(
    (await f.service.claim(f.adminActor, person.id, { operationId: 'other', now: NOW })).kind,
    'conflict',
  );
  await f.people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: NOW.toISOString(),
  });
  assert.equal(await f.service.contact(f.leadActor, person.id, NOW), null);
  assert.equal(
    (await f.service.list(f.adminActor, { now: NOW })).items.some(
      (row) => row.personId === person.id,
    ),
    false,
  );
  f.db.raw.close();
});
void test('completion is atomic, attributed and idempotent, rejects changed retry payloads, and leaves one welcomed event', async () => {
  const f = await fixture();
  const person = await f.member('welcome');
  assert.equal(
    (
      await f.service.complete(f.adminActor, person.id, {
        operationId: 'unclaimed',
        method: 'email',
        note: 'Hello',
        now: NOW,
      })
    ).kind,
    'conflict',
  );
  const claim = await f.service.claim(f.adminActor, person.id, { operationId: 'claim', now: NOW });
  assert.equal(claim.kind, 'ok');
  assert.deepEqual(
    await f.service.claim(f.adminActor, person.id, { operationId: 'claim', now: NOW }),
    claim,
  );
  const input = {
    operationId: 'complete',
    method: 'email' as const,
    note: 'Sent a personal welcome.',
    now: NOW,
  };
  const results = await Promise.all([
    f.service.complete(f.adminActor, person.id, input),
    f.service.complete(f.adminActor, person.id, input),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].kind, 'ok');
  assert.equal(
    (await f.service.complete(f.adminActor, person.id, { ...input, note: 'Changed' })).kind,
    'conflict',
  );
  assert.equal(
    (await f.service.complete(f.adminActor, person.id, { ...input, operationId: 'other' })).kind,
    'conflict',
  );
  const events = f.db.raw
    .prepare("SELECT details FROM engagement_events WHERE person_id=? AND type='welcomed'")
    .all(person.id);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.ok(event);
  assert.deepEqual(JSON.parse(String(event.details)), {
    actorId: f.admin.id,
    method: 'email',
    note: input.note,
  });
  assert.equal(await f.service.contact(f.adminActor, person.id, NOW), null);
  assert.equal(
    (await f.service.list(f.adminActor, { now: NOW })).items.some(
      (row) => row.personId === person.id,
    ),
    false,
  );
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='welcome.complete'").get()
      ?.n,
    1,
  );
  f.db.raw.close();
});
void test('welcome contact tolerates older signup records with interests in the wrong shape', async () => {
  const f = await fixture();
  const person = await f.member('old-shape');
  await f.people.recordEngagement(person.id, {
    type: 'joined',
    occurredAt: NOW.toISOString(),
    source: 'import',
    details: { interests: 'events' },
  });
  assert.equal(
    (await f.service.claim(f.adminActor, person.id, { operationId: 'claim', now: NOW })).kind,
    'ok',
  );
  const contact = await f.service.contact(f.adminActor, person.id, NOW);
  assert.equal(contact?.email, person.email);
  assert.deepEqual(contact.interests, []);
  f.db.raw.close();
});
