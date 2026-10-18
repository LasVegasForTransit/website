import assert from 'node:assert/strict';
import test from 'node:test';
import type { Db } from '../src/db';
import { loadActor } from '../src/staff-roles';
import {
  defineOrganizationRole,
  assignOrganizationRole,
  retireOrganizationRole,
  listPersonOrganizationRoles,
  listOrganizationRoles,
} from '../src/organization-roles';
import { mergeFixture } from './support/merge-fixture';

void test('overlapping organization roles block a merge without losing either association', async (t) => {
  const f = await mergeFixture();
  t.after(() => f.db.raw.close());
  const role = await defineOrganizationRole(f.db, f.actor, {
    name: 'Volunteer',
    operationId: 'define',
  });
  assert.equal(role.kind, 'ok');
  for (const personId of [f.survivor.id, f.merged.id])
    assert.equal(
      (
        await assignOrganizationRole(f.db, f.actor, {
          personId,
          roleId: role.value.id,
          operationId: `assign:${personId}`,
        })
      ).kind,
      'ok',
    );
  assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'conflict');
  assert.equal(
    f.db.raw
      .prepare('SELECT count(*) AS n FROM person_organization_roles WHERE ended_at IS NULL')
      .get()?.n,
    2,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM merges').get()?.n, 0);
  const ordinary = await loadActor(f.db, f.survivor.id);
  assert.ok(ordinary);
  await assert.rejects(() => listOrganizationRoles(f.db, ordinary));
  await assert.rejects(() => listPersonOrganizationRoles(f.db, ordinary, f.merged.id));
});

void test('role retirement and membership withdrawal immediately before assignment leave no partial role or receipt', async () => {
  for (const change of ['retired', 'former_member']) {
    const f = await mergeFixture();
    try {
      const role = await defineOrganizationRole(f.db, f.actor, {
        name: 'Volunteer',
        operationId: 'define',
      });
      assert.equal(role.kind, 'ok');
      const racing: Db = {
        prepare: (sql) => f.db.prepare(sql),
        batch: async (statements) => {
          if (change === 'retired')
            await retireOrganizationRole(f.db, f.actor, {
              roleId: role.value.id,
              operationId: 'retire',
            });
          else
            await f.people.withdrawConsent(f.survivor.id, {
              scope: 'newsletter',
              source: 'account',
              withdrawnAt: new Date().toISOString(),
            });
          return f.db.batch(statements);
        },
      };
      assert.notEqual(
        (
          await assignOrganizationRole(racing, f.actor, {
            personId: f.survivor.id,
            roleId: role.value.id,
            operationId: 'racing',
          })
        ).kind,
        'ok',
      );
      assert.equal(
        f.db.raw.prepare('SELECT count(*) AS n FROM person_organization_roles').get()?.n,
        0,
      );
      assert.equal(
        f.db.raw
          .prepare("SELECT count(*) AS n FROM staff_operations WHERE operation_id='racing'")
          .get()?.n,
        0,
      );
      assert.equal(
        f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE operation_id='racing'").get()
          ?.n,
        0,
      );
    } finally {
      f.db.raw.close();
    }
  }
});
