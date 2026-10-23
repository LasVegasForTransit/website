import assert from 'node:assert/strict';
import test from 'node:test';
const env = {
  LVBT_TASK_CHECKINS_ENABLED: 'true',
  LVBT_DEPLOYMENT_ENV: 'preview',
  LVBT_DISCORD_APPLICATION_ID: '111111111111111111',
  LVBT_DISCORD_GUILD_ID: '222222222222222222',
  LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
  LVBT_NOTION_TASK_SOURCE_ID: '10000000-0000-4000-8000-000000000001',
  LVBT_NOTION_TASK_PRODUCTION_SOURCE_ID: '10000000-0000-4000-8000-000000000099',
  LVBT_NOTION_TASK_API_KEY: 'notion-test',
  LVBT_DISCORD_BOT_TOKEN: 'discord-test',
};
void test('task worker runtime is independent of role sync and requires its own enablement, isolated sources and credentials', async () => {
  const module = await import('../src/notion-task-runtime');
  const runtime = module.taskCheckinWorkerRuntime;
  assert.ok(runtime, 'task worker configuration must exist');
  const independent = { ...env, LVBT_DISCORD_SYNC_ENABLED: 'false' };
  assert.equal(runtime(independent)?.sourceId, env.LVBT_NOTION_TASK_SOURCE_ID);
  for (const change of [
    { LVBT_TASK_CHECKINS_ENABLED: 'false' },
    { LVBT_NOTION_TASK_API_KEY: '' },
    { LVBT_DISCORD_BOT_TOKEN: '' },
    { LVBT_NOTION_TASK_SOURCE_ID: env.LVBT_NOTION_TASK_PRODUCTION_SOURCE_ID },
    { LVBT_DISCORD_GUILD_ID: env.LVBT_DISCORD_PRODUCTION_GUILD_ID },
  ])
    assert.equal(runtime({ ...env, ...change }), null);
});
void test('source isolation compares UUID identity rather than letter case', async () => {
  const { taskCheckinWorkerRuntime } = await import('../src/notion-task-runtime');
  assert.equal(
    taskCheckinWorkerRuntime({
      ...env,
      LVBT_NOTION_TASK_SOURCE_ID: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
      LVBT_NOTION_TASK_PRODUCTION_SOURCE_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }),
    null,
  );
});
void test('preference-only interaction context preserves isolation without enabling the worker', async () => {
  const { taskCheckinInteractionContext, taskCheckinWorkerRuntime } =
    await import('../src/notion-task-runtime');
  const disabled = {
    ...env,
    LVBT_TASK_CHECKINS_ENABLED: 'false',
    LVBT_NOTION_TASK_API_KEY: '',
    LVBT_DISCORD_BOT_TOKEN: '',
  };
  assert.equal(taskCheckinInteractionContext(disabled)?.preferencesOnly, true);
  assert.equal(taskCheckinWorkerRuntime(disabled), null);
  for (const change of [
    { LVBT_DEPLOYMENT_ENV: 'unknown' },
    { LVBT_DISCORD_APPLICATION_ID: '' },
    { LVBT_DISCORD_GUILD_ID: env.LVBT_DISCORD_PRODUCTION_GUILD_ID },
    { LVBT_NOTION_TASK_SOURCE_ID: env.LVBT_NOTION_TASK_PRODUCTION_SOURCE_ID },
    { LVBT_NOTION_TASK_SOURCE_ID: '' },
  ])
    assert.equal(taskCheckinInteractionContext({ ...disabled, ...change }), null);
});
void test('manual task updates work while reminder delivery stays disabled', async () => {
  const { taskCheckinInteractionContext, taskCheckinWorkerRuntime } =
    await import('../src/notion-task-runtime');
  const manual = {
    ...env,
    LVBT_TASK_CHECKINS_ENABLED: 'false',
    LVBT_TASK_UPDATES_ENABLED: 'true',
  };
  assert.equal(taskCheckinInteractionContext(manual)?.preferencesOnly, false);
  assert.equal(taskCheckinWorkerRuntime(manual), null);
  assert.equal(taskCheckinWorkerRuntime(manual, true)?.sourceId, env.LVBT_NOTION_TASK_SOURCE_ID);
  assert.equal(taskCheckinWorkerRuntime({ ...manual, LVBT_NOTION_TASK_API_KEY: '' }, true), null);
});
