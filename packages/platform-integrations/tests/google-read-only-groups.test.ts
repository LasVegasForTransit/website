import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleGroups } from '../src/google-groups';
import { readGoogleGroupInventory } from '../src/google-group-inventory';
import { configuration, groupEmail, reconciliation, directory } from './support/google-directory';
import { groupList, listedUser } from './support/google-group-list';

void test('an explicitly read-only staff group can be counted in preview without becoming writable', async () => {
  const config = {
    ...configuration,
    managedGroups: ['preview-other@lasvegasfortransit.org'],
    productionGroups: [groupEmail],
    readOnlyGroups: [groupEmail],
  };
  const fixture = groupList([{ members: [listedUser('staff-user')] }]);
  const client = new GoogleGroups(config, fixture.tokens, { fetch: fixture.fetch });
  const result = await readGoogleGroupInventory(client, {
    groupEmail,
    isCurrent: () => Promise.resolve(true),
  });
  assert.equal(result.userCount, 1);
  await assert.rejects(client.reconcile(reconciliation), { kind: 'not_configured' });
  assert.equal(
    fixture.calls.every((url) => !url.pathname.includes('/users/')),
    true,
  );
});

void test('a group marked read-only cannot be made a write target by overlapping configuration', async () => {
  const fixture = directory();
  const client = new GoogleGroups(
    {
      ...configuration,
      environment: 'production',
      managedGroups: [groupEmail],
      productionGroups: [groupEmail],
      readOnlyGroups: [groupEmail],
    },
    fixture.tokens,
    { fetch: fixture.fetch },
  );
  await assert.rejects(client.reconcile(reconciliation), { kind: 'not_configured' });
  assert.equal(fixture.calls.length, 0);
});
