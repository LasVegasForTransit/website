import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { unstable_readConfig } from 'wrangler';
import { DISCORD_RUNTIME_CONFIG } from '@lasvegasfortransit/platform-integrations/worker-runtime-config';
import { discordProviderConfiguration } from '@lasvegasfortransit/platform-integrations/discord-runtime';
interface WorkerConfiguration {
  workers_dev: boolean;
  preview_urls: boolean;
  vars: Record<string, string>;
  d1_databases: { database_id: string; migrations_dir: string }[];
  triggers: { crons: string[] };
  routes?: unknown[];
}
void test('preview jobs use isolated storage and disabled public URLs', () => {
  const file = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
  const production = unstable_readConfig({ config: file }) as WorkerConfiguration;
  const preview = unstable_readConfig({ config: file, env: 'preview' }) as WorkerConfiguration;
  assert.equal(production.workers_dev, false);
  assert.equal(production.preview_urls, false);
  assert.equal(production.vars.LVBT_DISCORD_SYNC_ENABLED, 'false');
  assert.equal(
    production.vars.LVBT_BEEHIIV_PUBLICATION_ID,
    'pub_d3178023-f8d5-4e9d-a768-0c4eaa6b7280',
  );
  assert.equal(preview.vars.LVBT_BEEHIIV_PUBLICATION_ID, '');
  assert.deepEqual(production.triggers.crons, []);
  assert.deepEqual(preview.triggers.crons, ['* * * * *']);
  for (const config of [production, preview]) {
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.deepEqual(config.routes ?? [], []);
    assert.equal(config.vars.LVBT_BEEHIIV_SYNC_ENABLED, 'false');
    assert.equal(
      config.vars.LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID,
      production.vars.LVBT_BEEHIIV_PUBLICATION_ID,
    );
    assert.equal(Object.hasOwn(config.vars, 'LVBT_BEEHIIV_API_KEY'), false);
    assert.equal(Object.hasOwn(config.vars, 'LVBT_NEWSLETTER_INTENT_KEY'), false);
  }
  assert.notEqual(production.d1_databases[0]?.database_id, preview.d1_databases[0]?.database_id);
  assert.equal(
    production.d1_databases[0]?.migrations_dir,
    '../../packages/platform-storage/migrations',
  );
  assert.equal(preview.vars.LVBT_DEPLOYMENT_ENV, 'preview');
  const staffFile = fileURLToPath(new URL('../../staff/wrangler.jsonc', import.meta.url));
  const staff = unstable_readConfig({ config: staffFile }) as WorkerConfiguration;
  const staffPreview = unstable_readConfig({
    config: staffFile,
    env: 'preview',
  }) as WorkerConfiguration;
  for (const config of [production, preview, staff, staffPreview]) {
    for (const value of DISCORD_RUNTIME_CONFIG) assert.ok(Object.hasOwn(config.vars, value.name));
    assert.equal(
      config.vars.LVBT_DISCORD_SYNC_ENABLED,
      config.vars.LVBT_DEPLOYMENT_ENV === 'preview' ? 'true' : 'false',
    );
    assert.equal(Object.hasOwn(config.vars, 'LVBT_DISCORD_BOT_TOKEN'), false);
  }
});

void test('preview Discord settings are enabled only for the isolated server', () => {
  for (const app of ['staff', 'jobs']) {
    const file = fileURLToPath(new URL(`../../${app}/wrangler.jsonc`, import.meta.url));
    const { vars } = unstable_readConfig({ config: file, env: 'preview' }) as WorkerConfiguration;
    assert.deepEqual(discordProviderConfiguration(vars), {
      configured: true,
      contextId: '1560146082640568350',
      memberRoleId: '1560151428180353104',
    });
    assert.equal(vars.LVBT_DISCORD_APPLICATION_ID, '1552481672945999872');
    assert.equal(vars.LVBT_DISCORD_PRODUCTION_GUILD_ID, '1509298455896522823');
    assert.equal(
      discordProviderConfiguration({
        ...vars,
        LVBT_DISCORD_GUILD_ID: '1509298455896522823',
      }).configured,
      false,
    );
  }
});
