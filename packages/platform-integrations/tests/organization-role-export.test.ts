import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, strFromU8 } from 'fflate/browser';
import {
  defineOrganizationRole,
  assignOrganizationRole,
} from '@lasvegasfortransit/platform-storage/organization-roles';
import { mergeFixture } from '../../platform-storage/tests/support/merge-fixture';
import { exportPeople } from '../src/export-archive';

void test('the downloaded administrator archive retains the role catalog and each person association', async (t) => {
  const f = await mergeFixture();
  t.after(() => f.db.raw.close());
  const role = await defineOrganizationRole(f.db, f.actor, {
    name: 'Board officer',
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
  const response = await exportPeople(f.db, f.actor, { now: new Date() });
  assert.equal(response.status, 200);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const document = files['export.json'];
  assert.ok(document);
  const data = JSON.parse(strFromU8(document)) as {
    organization_roles: Array<{ id: string; name: string }>;
    people: Array<{
      id: string;
      person_organization_roles: Array<{ role_id: string; person_id: string }>;
    }>;
  };
  assert.ok(Array.isArray(data.organization_roles));
  assert.equal(data.organization_roles[0]?.id, role.value.id);
  assert.equal(data.organization_roles[0].name, 'Board officer');
  const subject = data.people.find((person) => person.id === f.survivor.id);
  assert.ok(subject);
  assert.equal(subject.person_organization_roles[0]?.role_id, role.value.id);
  assert.equal(subject.person_organization_roles[0].person_id, f.survivor.id);
  assert.equal(
    data.people.find((person) => person.id === f.merged.id)?.person_organization_roles.length,
    0,
  );
});
