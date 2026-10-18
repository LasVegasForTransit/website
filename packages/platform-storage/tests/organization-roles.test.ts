import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { loadActor } from '../src/staff-roles';
import { can } from '@lasvegasfortransit/platform-core/permissions';
import type { Db } from '../src/db';

async function api() {
  const loaded = await import('../src/organization-roles').catch(() => null);
  assert.ok(loaded, 'organization roles need a catalog independent from committee permissions');
  return loaded;
}
void test('administrators define, rename and retire roles independently from person associations', async (t) => {
  const roles = await api(),
    f = await mergeFixture();
  t.after(() => f.db.raw.close());
  const defined = await roles.defineOrganizationRole(f.db, f.actor, {
    name: '  Board   officer ',
    operationId: 'define',
  });
  assert.equal(defined.kind, 'ok');
  const roleId = defined.value.id;
  assert.equal(defined.value.name, 'Board officer');
  assert.deepEqual(
    await roles.defineOrganizationRole(f.db, f.actor, {
      name: '  Board   officer ',
      operationId: 'define',
    }),
    defined,
  );
  assert.notEqual(
    (
      await roles.defineOrganizationRole(f.db, f.actor, {
        name: 'BOARD OFFICER',
        operationId: 'duplicate',
      })
    ).kind,
    'ok',
  );
  const second = await roles.defineOrganizationRole(f.db, f.actor, {
    name: 'Volunteer',
    operationId: 'second',
  });
  assert.equal(second.kind, 'ok');
  for (const id of [roleId, second.value.id])
    assert.equal(
      (
        await roles.assignOrganizationRole(f.db, f.actor, {
          personId: f.survivor.id,
          roleId: id,
          operationId: `assign:${id}`,
        })
      ).kind,
      'ok',
    );
  assert.equal((await roles.listPersonOrganizationRoles(f.db, f.actor, f.survivor.id)).length, 2);
  const actor = await loadActor(f.db, f.survivor.id);
  assert.ok(actor);
  assert.equal(can(actor, 'console.enter'), false);
  assert.equal(can(actor, 'staff_admin.manage'), false);
  assert.deepEqual(actor.committees, []);
  assert.equal(
    (
      await roles.renameOrganizationRole(f.db, f.actor, {
        roleId,
        name: 'Board member',
        operationId: 'rename',
      })
    ).kind,
    'ok',
  );
  assert.equal(
    (await roles.listPersonOrganizationRoles(f.db, f.actor, f.survivor.id)).find(
      (r) => r.roleId === roleId,
    )?.name,
    'Board member',
  );
  assert.equal(
    (await roles.retireOrganizationRole(f.db, f.actor, { roleId, operationId: 'retire' })).kind,
    'ok',
  );
  assert.equal((await roles.listOrganizationRoles(f.db, f.actor)).length, 1);
  assert.equal(
    (await roles.listOrganizationRoles(f.db, f.actor, { includeRetired: true })).length,
    2,
  );
  assert.ok(
    (await roles.listPersonOrganizationRoles(f.db, f.actor, f.survivor.id)).find(
      (r) => r.roleId === roleId,
    )?.retiredAt,
  );
  assert.notEqual(
    (
      await roles.assignOrganizationRole(f.db, f.actor, {
        personId: f.merged.id,
        roleId,
        operationId: 'retired-assignment',
      })
    ).kind,
    'ok',
  );
  assert.equal(
    (
      await roles.removeOrganizationRole(f.db, f.actor, {
        personId: f.survivor.id,
        roleId,
        operationId: 'remove',
      })
    ).kind,
    'ok',
  );
  assert.equal((await roles.listPersonOrganizationRoles(f.db, f.actor, f.survivor.id)).length, 1);
  const audit = f.db.raw
    .prepare("SELECT actor_id,action,details FROM staff_audits WHERE operation_id='assign:'||?")
    .get(roleId);
  assert.equal(audit?.actor_id, f.admin.id);
  assert.equal(audit.action, 'organization_role.assign');
  assert.equal((JSON.parse(String(audit.details)) as { roleId: unknown }).roleId, roleId);
});

void test('organization role mutations validate names and recheck administrator authority atomically', async (t) => {
  const roles = await api(),
    f = await mergeFixture();
  t.after(() => f.db.raw.close());
  for (const name of ['', '  ', 'x'.repeat(101), 'Title\nOther'])
    assert.equal(
      (await roles.defineOrganizationRole(f.db, f.actor, { name, operationId: 'invalid' })).kind,
      'invalid',
    );
  const ordinary = await loadActor(f.db, f.survivor.id);
  assert.ok(ordinary);
  assert.equal(
    (await roles.defineOrganizationRole(f.db, ordinary, { name: 'Forged', operationId: 'forged' }))
      .kind,
    'forbidden',
  );
  f.db.raw.exec(
    "CREATE TRIGGER reject_role_audit BEFORE INSERT ON staff_audits WHEN NEW.action='organization_role.define' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END",
  );
  await assert.rejects(
    () =>
      roles.defineOrganizationRole(f.db, f.actor, { name: 'Rolled back', operationId: 'failed' }),
    /fixture audit failure/,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM organization_roles').get()?.n, 0);
  f.db.raw.exec('DROP TRIGGER reject_role_audit');
  const racing: Db = {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      await f.people.withdrawConsent(f.admin.id, {
        scope: 'newsletter',
        source: 'account',
        withdrawnAt: new Date().toISOString(),
      });
      return f.db.batch(statements);
    },
  };
  assert.notEqual(
    (await roles.defineOrganizationRole(racing, f.actor, { name: 'Stale', operationId: 'stale' }))
      .kind,
    'ok',
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM organization_roles').get()?.n, 0);
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_operations WHERE operation_id='stale'").get()
      ?.n,
    0,
  );
});
