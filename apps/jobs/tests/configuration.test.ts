import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { unstable_readConfig } from 'wrangler';
import { DISCORD_RUNTIME_CONFIG } from '@lasvegasfortransit/platform-integrations/worker-runtime-config';
interface WorkerConfiguration {
  workers_dev: boolean;
  preview_urls: boolean;
  vars: Record<string, string>;
  d1_databases: { database_id: string; migrations_dir: string }[];
}
void test('preview jobs use isolated storage and disabled public URLs', () => {
  const file = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
  const production = unstable_readConfig({ config: file }) as WorkerConfiguration;
  const preview = unstable_readConfig({ config: file, env: 'preview' }) as WorkerConfiguration;
  assert.equal(production.workers_dev, false);
  assert.equal(production.preview_urls, false);
  assert.equal(production.vars.LVBT_DISCORD_SYNC_ENABLED, 'false');
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
    assert.equal(config.vars.LVBT_DISCORD_SYNC_ENABLED, 'false');
    assert.equal(Object.hasOwn(config.vars, 'LVBT_DISCORD_BOT_TOKEN'), false);
  }
});
