import assert from 'node:assert/strict';
import test from 'node:test';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { createSession } from '../src/auth';
import { collectPersonExport } from '../src/person-export';
import { collectFullExport } from '../src/full-export';
import { runMaintenance } from '../src/retention';
import {
  defineOrganizationRole,
  assignOrganizationRole,
  listPersonOrganizationRoles,
} from '../src/organization-roles';
import { mergeFixture } from './support/merge-fixture';

void test('organization role associations move with a merge and return to their original people on undo', async (t) => {
  const f = await mergeFixture();
  t.after(() => f.db.raw.close());
  const ids: string[] = [];
  for (const [personId, name] of [
    [f.survivor.id, 'Volunteer'],
    [f.merged.id, 'Board officer'],
  ]) {
    assert.ok(personId && name);
    const role = await defineOrganizationRole(f.db, f.actor, {
      name,
      operationId: `define:${name}`,
    });
    assert.equal(role.kind, 'ok');
    ids.push(role.value.id);
    assert.equal(
      (
        await assignOrganizationRole(f.db, f.actor, {
          personId,
          roleId: role.value.id,
          operationId: `assign:${name}`,
        })
      ).kind,
      'ok',
    );
  }
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  assert.equal((await listPersonOrganizationRoles(f.db, f.actor, f.survivor.id)).length, 2);
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Separate records.',
        operationId: 'undo',
      })
    ).kind,
    'ok',
  );
  assert.deepEqual(
    (await listPersonOrganizationRoles(f.db, f.actor, f.survivor.id)).map((r) => r.roleId),
    [ids[0]],
  );
  assert.deepEqual(
    (await listPersonOrganizationRoles(f.db, f.actor, f.merged.id)).map((r) => r.roleId),
    [ids[1]],
  );
});

void test('personal exports include only the subject role labels and erasure removes associations immediately', async (t) => {
  const f = await mergeFixture();
  t.after(() => f.db.raw.close());
  const role = await defineOrganizationRole(f.db, f.actor, {
    name: 'Volunteer',
    operationId: 'define',
  });
  assert.equal(role.kind, 'ok');
  assert.equal(
    (
      await assignOrganizationRole(f.db, f.actor, {
        personId: f.survivor.id,
        roleId: role.value.id,
        operationId: 'assign',
      })
    ).kind,
    'ok',
  );
  const env = { PLATFORM_DB: f.db, LVBT_SIGN_IN_SECRET: 'role-export-fixture' };
  const session = await createSession(env, f.survivor.id, 'member');
  const exported = await collectPersonExport(f.db, f.survivor.id, {
    kind: 'member',
    personId: f.survivor.id,
    sessionHash: await hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${session.token}`),
  });
  assert.ok(exported);
  assert.ok(Array.isArray(exported.organization_roles));
  const roles = exported.organization_roles as Array<Record<string, unknown>>;
  assert.equal(roles.length, 1);
  assert.equal(roles[0]?.name, 'Volunteer');
  assert.equal(JSON.stringify(roles).includes(f.admin.id), false);
  const archive = await collectFullExport(f.db, f.actor, new Date());
  assert.ok(archive);
  assert.ok(Array.isArray(archive.organization_roles));
  assert.ok(Array.isArray(archive.person_organization_roles));
  assert.equal(archive.organization_roles[0]?.name, 'Volunteer');
  assert.equal(archive.person_organization_roles[0]?.person_id, f.survivor.id);
  await f.people.deletePerson(f.survivor.id);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM person_organization_roles').get()?.n, 0);
  await runMaintenance(f.db, { now: new Date('2030-10-18T00:00:00.000Z') });
  assert.equal(f.db.raw.prepare('SELECT id FROM people WHERE id=?').get(f.survivor.id), undefined);
  assert.notEqual(
    (
      await assignOrganizationRole(f.db, f.actor, {
        personId: f.survivor.id,
        roleId: role.value.id,
        operationId: 'recreate',
      })
    ).kind,
    'ok',
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM organization_roles').get()?.n, 1);
});
