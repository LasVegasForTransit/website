import assert from 'node:assert/strict';
import test from 'node:test';
import { setupBindings } from '../scripts/preview-setup';
import { disabledProviderBindings } from '../scripts/preflight-workers';
const binding = (name: string, text: string) => ({ name, type: 'plain_text', text });
void test('setup and disabled-deployment checks reject task messaging even when role and newsletter sync are off', () => {
  const bindings = [
    binding('LVBT_DEPLOYMENT_ENV', 'preview'),
    binding('LVBT_DISCORD_SYNC_ENABLED', 'false'),
    binding('LVBT_BEEHIIV_SYNC_ENABLED', 'false'),
    binding('LVBT_TASK_CHECKINS_ENABLED', 'true'),
  ];
  assert.equal(setupBindings(bindings), false);
  assert.equal(disabledProviderBindings(bindings, 'preview'), false);
});
void test('enabled task deployment requires isolated source/guild configuration and both secret bindings', async () => {
  const module = await import('../scripts/preflight-workers');
  const ready = module.taskCheckinBindingsReady;
  assert.ok(ready);
  const values = {
    LVBT_TASK_CHECKINS_ENABLED: 'true',
    LVBT_DEPLOYMENT_ENV: 'preview',
    LVBT_DISCORD_APPLICATION_ID: '111111111111111111',
    LVBT_DISCORD_GUILD_ID: '222222222222222222',
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
    LVBT_NOTION_TASK_SOURCE_ID: '10000000-0000-4000-8000-000000000001',
    LVBT_NOTION_TASK_PRODUCTION_SOURCE_ID: '10000000-0000-4000-8000-000000000099',
  };
  const bindings: Record<string, unknown>[] = Object.entries(values).map(([name, text]) =>
    binding(name, text),
  );
  assert.equal(ready(bindings, 'preview'), false);
  bindings.push(
    { name: 'LVBT_NOTION_TASK_API_KEY', type: 'secret_text' },
    { name: 'LVBT_DISCORD_BOT_TOKEN', type: 'secret_text' },
  );
  assert.equal(ready(bindings, 'preview'), true);
  assert.equal(ready(bindings, 'production'), false);
  assert.equal(ready([binding('LVBT_TASK_CHECKINS_ENABLED', 'false')], 'preview'), true);
});
