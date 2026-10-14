import assert from 'node:assert/strict';
import test from 'node:test';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';

async function runtime() {
  const module = await import('../src/beehiiv-runtime').catch(() => null);
  assert.ok(module, 'Scheduled newsletter work needs explicit, isolated runtime configuration');
  return module.beehiivRuntime;
}
void test('newsletter synchronization requires complete configuration and an explicit enabled flag', async () => {
  const read = await runtime();
  const base = {
    LVBT_DEPLOYMENT_ENV: 'preview',
    LVBT_BEEHIIV_SYNC_ENABLED: 'true',
    LVBT_BEEHIIV_PUBLICATION_ID: 'pub_preview',
    LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID: 'pub_production',
    LVBT_BEEHIIV_API_KEY: 'fixture-only',
    LVBT_NEWSLETTER_INTENT_KEY: randomToken(),
  };
  assert.ok(read(base));
  for (const changed of [
    { LVBT_BEEHIIV_SYNC_ENABLED: 'false' },
    { LVBT_BEEHIIV_SYNC_ENABLED: '' },
    { LVBT_DEPLOYMENT_ENV: 'development' },
    { LVBT_BEEHIIV_PUBLICATION_ID: '' },
    { LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID: '' },
    { LVBT_BEEHIIV_API_KEY: '' },
    { LVBT_NEWSLETTER_INTENT_KEY: '' },
    { LVBT_NEWSLETTER_INTENT_KEY: 'invalid' },
    { LVBT_BEEHIIV_API_KEY: base.LVBT_NEWSLETTER_INTENT_KEY },
    { LVBT_BEEHIIV_PUBLICATION_ID: 'pub_production' },
    { LVBT_DEPLOYMENT_ENV: 'production' },
  ])
    assert.equal(read({ ...base, ...changed }), null);
  assert.ok(
    read({
      ...base,
      LVBT_DEPLOYMENT_ENV: 'production',
      LVBT_BEEHIIV_PUBLICATION_ID: 'pub_production',
    }),
  );
});
