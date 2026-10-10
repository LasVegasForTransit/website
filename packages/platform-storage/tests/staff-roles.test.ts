import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { linkWorkspaceIdentity } from '../src/workspace-link';
import { memoryDb } from './support/db';
async function fixture() {
  const loaded = await import('../src/staff-roles').catch(() => null);
  assert.ok(loaded, 'staff roles must come from current persisted records');
  const db = memoryDb();
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'president@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  await linkWorkspaceIdentity(db, {
    workspace: {
      subject: 'president-subject',
      email: 'president@lasvegasfortransit.org',
      givenName: null,
      familyName: null,
    },
    personId: person.id,
    method: 'self_linked',
    operationId: 'fixture-link',
  });
  return { ...loaded, db, person };
}
void test('a Workspace identity grants volunteer facts and never automatically grants administrator access', async () => {
  const { db, person, loadActor } = await fixture();
  const actor = await loadActor(db, person.id);
  assert.ok(actor);
  assert.equal(actor.workspaceLinked, true);
  assert.equal(actor.staffAdmin, false);
  assert.deepEqual(actor.committees, []);
  db.raw.prepare('UPDATE people SET deleted_at = ? WHERE id = ?').run('2026-10-04', person.id);
  assert.equal(await loadActor(db, person.id), null);
  db.raw.close();
});
void test('bootstrap requires the explicit president record and its linked Google subject; retries create one audited designation', async () => {
  const { db, person, bootstrapStaffAdmin, loadActor } = await fixture();
  const input = {
    presidentPersonId: person.id,
    workspaceSubject: 'wrong',
    performedBy: 'maintainer-fixture',
    operationId: 'bootstrap',
  };
  assert.equal((await bootstrapStaffAdmin(db, input)).kind, 'invalid');
  const correct = { ...input, workspaceSubject: 'president-subject' };
  assert.equal((await bootstrapStaffAdmin(db, correct)).kind, 'ok');
  assert.equal((await bootstrapStaffAdmin(db, correct)).kind, 'ok');
  assert.equal((await loadActor(db, person.id))?.staffAdmin, true);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM staff_administrators').get()?.n, 1);
  assert.equal(
    db.raw
      .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='staff_admin.bootstrap'")
      .get()?.n,
    1,
  );
  db.raw.close();
});
void test('last-admin removal is refused, stale admin facts cannot change designations, and concurrent removals preserve an active admin', async () => {
  const { db, person, bootstrapStaffAdmin, staffAdminManage, loadActor } = await fixture();
  await bootstrapStaffAdmin(db, {
    presidentPersonId: person.id,
    workspaceSubject: 'president-subject',
    performedBy: 'maintainer-fixture',
    operationId: 'bootstrap',
  });
  const president = await loadActor(db, person.id);
  assert.ok(president);
  assert.equal(
    (
      await staffAdminManage(db, president, {
        targetPersonId: person.id,
        enabled: false,
        operationId: 'remove-last',
      })
    ).kind,
    'last_admin',
  );
  const { person: second } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'second@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  assert.equal(
    (
      await staffAdminManage(db, president, {
        targetPersonId: second.id,
        enabled: true,
        operationId: 'add-second',
      })
    ).kind,
    'ok',
  );
  const other = await loadActor(db, second.id);
  assert.ok(other);
  const outcomes = await Promise.all([
    staffAdminManage(db, president, {
      targetPersonId: second.id,
      enabled: false,
      operationId: 'remove-second',
    }),
    staffAdminManage(db, other, {
      targetPersonId: person.id,
      enabled: false,
      operationId: 'remove-president',
    }),
  ]);
  assert.equal(outcomes.filter((r) => r.kind === 'ok').length, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM staff_administrators').get()?.n, 1);
  assert.equal(
    (
      await staffAdminManage(db, other, {
        targetPersonId: second.id,
        enabled: true,
        operationId: 'stale',
      })
    ).kind,
    'forbidden',
  );
  db.raw.close();
});
void test('authorization denials retain the actor and permission without hidden target details', async () => {
  const { auditDenied } = await import('../src/audits');
  const { db, person } = await fixture();
  await auditDenied(db, person.id, 'person.view');
  const audit = db.raw
    .prepare('SELECT actor_id,permission,target_id,details FROM staff_audits')
    .get();
  assert.ok(audit);
  assert.equal(audit.actor_id, person.id);
  assert.equal(audit.permission, 'person.view');
  assert.equal(audit.target_id, null);
  assert.equal(audit.details, null);
  db.raw.close();
});

void test('an administrator can step down when another administrator remains, with a recorded receipt', async () => {
  const { db, person, bootstrapStaffAdmin, staffAdminManage, loadActor } = await fixture();
  await bootstrapStaffAdmin(db, {
    presidentPersonId: person.id,
    workspaceSubject: 'president-subject',
    performedBy: 'maintainer-fixture',
    operationId: 'bootstrap',
  });
  const actor = await loadActor(db, person.id);
  assert.ok(actor);
  const { person: other } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'other@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  await staffAdminManage(db, actor, {
    targetPersonId: other.id,
    enabled: true,
    operationId: 'add-other',
  });
  assert.equal(
    (
      await staffAdminManage(db, actor, {
        targetPersonId: person.id,
        enabled: false,
        operationId: 'step-down',
      })
    ).kind,
    'ok',
  );
  assert.equal((await loadActor(db, person.id))?.staffAdmin, false);
  assert.equal(
    db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE operation_id='step-down'").get()
      ?.n,
    1,
  );
  db.raw.close();
});
