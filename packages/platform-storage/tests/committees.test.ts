import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { linkWorkspaceIdentity } from '../src/workspace-link';
import { memoryDb } from './support/db';
async function fixture() {
  const committees = await import('../src/committees').catch(() => null);
  assert.ok(committees, 'assignments must persist atomically with durable provider work');
  const { bootstrapStaffAdmin } = await import('../src/staff-roles');
  const db = memoryDb();
  const people = new PersonService(db);
  const { person: admin } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'admin@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'volunteer@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  await linkWorkspaceIdentity(db, {
    workspace: {
      subject: 'admin-subject',
      email: 'admin@lasvegasfortransit.org',
      givenName: null,
      familyName: null,
    },
    personId: admin.id,
    method: 'self_linked',
    operationId: 'link-admin',
  });
  await bootstrapStaffAdmin(db, {
    presidentPersonId: admin.id,
    workspaceSubject: 'admin-subject',
    performedBy: 'maintainer-fixture',
    operationId: 'bootstrap',
  });
  return { db, admin, person, service: new committees.CommitteeService(db) };
}
void test('nine committees are seeded, one assignment is current, and retried changes create one event and operation', async () => {
  const { db, admin, person, service } = await fixture();
  assert.deepEqual(
    db.raw
      .prepare('SELECT name FROM committees ORDER BY name')
      .all()
      .map((r) => r.name),
    [
      'Advocacy Team',
      'Board of Directors',
      'Civic Tech Team',
      'Events Committee',
      'Media Committee',
      'Membership Committee',
      'Public Engagement',
      'Transit and Urbanist Education',
      'UNLV Student Leadership',
    ],
  );
  const first = await service.assign({
    personId: person.id,
    committeeId: 'events',
    role: 'member',
    actorId: admin.id,
    operationId: 'assign',
  });
  assert.equal(first.kind, 'ok');
  assert.equal(
    (
      await service.assign({
        personId: person.id,
        committeeId: 'events',
        role: 'member',
        actorId: admin.id,
        operationId: 'assign',
      })
    ).kind,
    'ok',
  );
  assert.equal(
    (
      await service.assign({
        personId: person.id,
        committeeId: 'events',
        role: 'lead',
        actorId: admin.id,
        operationId: 'another-assign',
      })
    ).kind,
    'conflict',
  );
  const changed = await service.changeRole(first.value.id, 'lead', admin.id, 'change');
  assert.equal(changed.kind, 'ok');
  assert.equal(changed.value.startedAt, first.value.startedAt);
  assert.equal((await service.changeRole(first.value.id, 'lead', admin.id, 'change')).kind, 'ok');
  assert.equal(
    db.raw.prepare("SELECT count(*) AS n FROM engagement_events WHERE type='role_changed'").get()
      ?.n,
    2,
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM integration_outbox').get()?.n, 2);
  const details = JSON.parse(
    String(
      db.raw.prepare("SELECT details FROM engagement_events WHERE reference='change'").get()
        ?.details,
    ),
  ) as { oldRole: string; newRole: string; actorId: string };
  assert.deepEqual(
    [details.oldRole, details.newRole, details.actorId],
    ['member', 'lead', admin.id],
  );
  assert.equal(
    (await service.endAssignment(first.value.id, 'stepped_back', admin.id, 'end')).kind,
    'ok',
  );
  const next = await service.assign({
    personId: person.id,
    committeeId: 'events',
    role: 'member',
    actorId: admin.id,
    operationId: 'rejoin',
  });
  assert.equal(next.kind, 'ok');
  assert.notEqual(next.value.id, first.value.id);
  assert.equal(
    db.raw.prepare('SELECT count(*) AS n FROM committee_assignments WHERE ended_at IS NULL').get()
      ?.n,
    1,
  );
  assert.equal(
    db.raw.prepare('SELECT end_reason FROM committee_assignments WHERE id = ?').get(first.value.id)
      ?.end_reason,
    'stepped_back',
  );
  db.raw.close();
});
void test('lead authority disappears immediately on assignment end and does not allow other committees', async () => {
  const { db, admin, person, service } = await fixture();
  const { loadActor } = await import('../src/staff-roles');
  const lead = await service.assign({
    personId: person.id,
    committeeId: 'events',
    role: 'lead',
    actorId: admin.id,
    operationId: 'make-lead',
  });
  assert.equal(lead.kind, 'ok');
  const { person: target } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'new@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  assert.equal(
    (
      await service.assign({
        personId: target.id,
        committeeId: 'advocacy',
        role: 'member',
        actorId: person.id,
        operationId: 'outside',
      })
    ).kind,
    'forbidden',
  );
  assert.equal(
    (
      await service.assign({
        personId: target.id,
        committeeId: 'events',
        role: 'member',
        actorId: person.id,
        operationId: 'inside',
      })
    ).kind,
    'ok',
  );
  await service.endAssignment(lead.value.id, 'stepped_back', admin.id, 'end-lead');
  assert.deepEqual((await loadActor(db, person.id))?.committees, []);
  assert.equal(
    (
      await service.assign({
        personId: target.id,
        committeeId: 'events',
        role: 'lead',
        actorId: person.id,
        operationId: 'after-revocation',
      })
    ).kind,
    'forbidden',
  );
  db.raw.close();
});
void test('new assignment generations invalidate queued old grants without losing the accepted assignment', async () => {
  const { db, admin, person, service } = await fixture();
  const { operationIsCurrent, markOperationFailed } = await import('../src/outbox');
  const first = await service.assign({
    personId: person.id,
    committeeId: 'events',
    role: 'member',
    actorId: admin.id,
    operationId: 'grant',
  });
  assert.equal(first.kind, 'ok');
  assert.equal(await operationIsCurrent(db, 'grant'), true);
  await markOperationFailed(db, 'grant', 'provider_unavailable');
  assert.equal(db.raw.prepare('SELECT role FROM committee_assignments').get()?.role, 'member');
  await service.endAssignment(first.value.id, 'stepped_back', admin.id, 'revoke');
  assert.equal(await operationIsCurrent(db, 'grant'), false);
  assert.equal(await operationIsCurrent(db, 'revoke'), true);
  db.raw.close();
});
