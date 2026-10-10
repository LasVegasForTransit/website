import assert from 'node:assert/strict';
import test from 'node:test';

const base = {
  LVBT_DEPLOYMENT_ENV: 'production',
  LVBT_GOOGLE_ACCESS_OBSERVATIONS_ENABLED: 'true',
  LVBT_GOOGLE_CUSTOMER_ID: 'C01234567',
  LVBT_GOOGLE_PRODUCTION_CUSTOMER_ID: 'C01234567',
};

void test('staff Google access context uses the isolated Workspace customer without exposing credentials', async () => {
  const loaded = await import('../src/google-runtime').catch(() => null);
  assert.ok(loaded, 'staff access views need validated Google Workspace context');
  assert.deepEqual(loaded.googleProviderConfiguration(base), {
    configured: true,
    contextId: 'C01234567',
  });
  assert.deepEqual(
    loaded.googleProviderConfiguration({
      ...base,
      LVBT_DEPLOYMENT_ENV: 'preview',
      LVBT_GOOGLE_CUSTOMER_ID: 'C07654321',
    }),
    { configured: true, contextId: 'C07654321' },
  );
  assert.deepEqual(
    loaded.googleProviderConfiguration({
      ...base,
      LVBT_DEPLOYMENT_ENV: 'preview',
      LVBT_GOOGLE_CUSTOMER_ID: 'C01234567',
    }),
    { configured: false, contextId: '' },
  );
  assert.deepEqual(loaded.googleProviderConfiguration({ ...base, LVBT_GOOGLE_CUSTOMER_ID: '' }), {
    configured: false,
    contextId: '',
  });
  assert.deepEqual(
    loaded.googleProviderConfiguration({
      ...base,
      LVBT_GOOGLE_ACCESS_OBSERVATIONS_ENABLED: 'false',
    }),
    { configured: false, contextId: '' },
  );
  assert.deepEqual(
    loaded.googleProviderConfiguration({ ...base, LVBT_GOOGLE_CUSTOMER_ID: 'admin@lvbt.org' }),
    { configured: false, contextId: '' },
  );
  const tokenBearing = {
    ...base,
    LVBT_GOOGLE_ACCESS_TOKEN: 'sensitive-token',
  };
  const publicContext = loaded.googleProviderConfiguration(tokenBearing);
  assert.equal(JSON.stringify(publicContext).includes('sensitive-token'), false);
});
