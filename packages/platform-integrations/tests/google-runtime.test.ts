import assert from 'node:assert/strict';
import test from 'node:test';

const productionGroup = 'advocacy@lasvegasfortransit.org';
const previewGroup = 'preview-advocacy@lasvegasfortransit.org';
const consoleGroup = 'console-users@lasvegasfortransit.org';
const base = {
  LVBT_DEPLOYMENT_ENV: 'production',
  LVBT_GOOGLE_ACCESS_OBSERVATIONS_ENABLED: 'true',
  LVBT_GOOGLE_CUSTOMER_ID: 'C01234567',
  LVBT_GOOGLE_PRODUCTION_CUSTOMER_ID: 'C01234567',
  LVBT_GOOGLE_MANAGED_GROUPS: JSON.stringify([productionGroup]),
  LVBT_GOOGLE_PRODUCTION_GROUPS: JSON.stringify([productionGroup]),
  LVBT_GOOGLE_CONSOLE_GROUP_EMAIL: consoleGroup,
};

void test('Google observations stay in the pinned LVBT tenant and explicitly registered groups', async () => {
  const loaded = await import('../src/google-runtime');
  assert.deepEqual(loaded.googleProviderConfiguration(base), {
    configured: true,
    contextId: 'C01234567',
    resourceIds: [productionGroup],
  });
  assert.deepEqual(
    loaded.googleProviderConfiguration({
      ...base,
      LVBT_DEPLOYMENT_ENV: 'preview',
      LVBT_GOOGLE_MANAGED_GROUPS: JSON.stringify([previewGroup]),
    }),
    { configured: true, contextId: 'C01234567', resourceIds: [previewGroup] },
  );
  for (const patch of [
    { LVBT_GOOGLE_CUSTOMER_ID: 'Cother' },
    { LVBT_GOOGLE_CUSTOMER_ID: 'my_customer', LVBT_GOOGLE_PRODUCTION_CUSTOMER_ID: 'my_customer' },
    { LVBT_GOOGLE_ACCESS_OBSERVATIONS_ENABLED: 'false' },
    { LVBT_DEPLOYMENT_ENV: 'unknown' },
    { LVBT_GOOGLE_MANAGED_GROUPS: 'invalid-json' },
    { LVBT_GOOGLE_MANAGED_GROUPS: JSON.stringify(['outsider@example.invalid']) },
    { LVBT_GOOGLE_MANAGED_GROUPS: JSON.stringify([consoleGroup]) },
    { LVBT_GOOGLE_PRODUCTION_GROUPS: '[]' },
    { LVBT_GOOGLE_PRODUCTION_GROUPS: JSON.stringify(['other@lasvegasfortransit.org']) },
    { LVBT_DEPLOYMENT_ENV: 'preview' },
  ])
    assert.deepEqual(loaded.googleProviderConfiguration({ ...base, ...patch }), {
      configured: false,
      contextId: '',
    });
  assert.deepEqual(
    loaded.googleProviderConfiguration({
      ...base,
      LVBT_DEPLOYMENT_ENV: 'preview',
      LVBT_GOOGLE_CUSTOMER_ID: 'Cother',
      LVBT_GOOGLE_MANAGED_GROUPS: JSON.stringify([previewGroup]),
    }),
    { configured: false, contextId: '' },
  );
  const tokenBearing = {
    ...base,
    LVBT_GOOGLE_ACCESS_TOKEN: 'synthetic-private-token',
  };
  const context = loaded.googleProviderConfiguration(tokenBearing);
  assert.equal(JSON.stringify(context).includes('synthetic-private-token'), false);
});

void test('the staff sign-in group is available only to the read-only inventory configuration', async () => {
  const loaded = await import('../src/google-runtime');
  assert.equal(
    typeof loaded.googleGroupInventoryConfiguration,
    'function',
    'staff counts need an explicit read-only console target',
  );
  const result = loaded.googleGroupInventoryConfiguration(base);
  assert.equal(result.consoleGroupEmail, consoleGroup);
  assert.deepEqual(result.provider, {
    configured: true,
    contextId: 'C01234567',
    resourceIds: [productionGroup, consoleGroup],
  });
  assert.deepEqual(loaded.googleProviderConfiguration(base).resourceIds, [productionGroup]);
  const readonlyOnly = {
    ...base,
    LVBT_GOOGLE_MANAGED_GROUPS: '[]',
    LVBT_GOOGLE_PRODUCTION_GROUPS: '[]',
  };
  assert.deepEqual(loaded.googleProviderConfiguration(readonlyOnly), {
    configured: false,
    contextId: '',
  });
  assert.deepEqual(loaded.googleGroupInventoryConfiguration(readonlyOnly).provider, {
    configured: true,
    contextId: 'C01234567',
    resourceIds: [consoleGroup],
  });
});
