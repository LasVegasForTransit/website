import assert from 'node:assert/strict';
import test from 'node:test';
const environment = {
  LVBT_DEPLOYMENT_ENV: 'preview',
  LVBT_DISCORD_SYNC_ENABLED: 'true',
  LVBT_DISCORD_APPLICATION_ID: '111111111111111111',
  LVBT_DISCORD_MEMBER_ROLE_ID: '333333333333333333',
  LVBT_DISCORD_GUILD_ID: '444444444444444444',
  LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
  LVBT_DISCORD_BOT_TOKEN: 'fixture-only',
};
void test('jobs require enabled and isolated configuration, while staff receives only public server context', async () => {
  const loaded = await import('../src/discord-runtime').catch(() => null);
  assert.ok(
    loaded,
    'the scheduled Worker and staff views must share validated server configuration',
  );
  assert.equal(
    loaded.discordRuntime(environment)?.configuration.guildId,
    environment.LVBT_DISCORD_GUILD_ID,
  );
  assert.equal(loaded.discordRuntime({ ...environment, LVBT_DISCORD_BOT_TOKEN: '' }), null);
  assert.equal(loaded.discordRuntime({ ...environment, LVBT_DISCORD_SYNC_ENABLED: 'false' }), null);
  assert.equal(
    loaded.discordRuntime({
      ...environment,
      LVBT_DISCORD_GUILD_ID: environment.LVBT_DISCORD_PRODUCTION_GUILD_ID,
    }),
    null,
  );
  assert.equal(
    loaded.discordRuntime({
      ...environment,
      LVBT_DISCORD_MEMBER_ROLE_ID: environment.LVBT_DISCORD_GUILD_ID,
    }),
    null,
  );
  assert.equal(loaded.discordRuntime({ ...environment, LVBT_DEPLOYMENT_ENV: 'production' }), null);
  const publicContext = loaded.discordProviderConfiguration({
    ...environment,
    LVBT_DISCORD_BOT_TOKEN: '',
  });
  assert.deepEqual(publicContext, {
    configured: true,
    contextId: environment.LVBT_DISCORD_GUILD_ID,
    memberRoleId: environment.LVBT_DISCORD_MEMBER_ROLE_ID,
  });
  assert.equal(JSON.stringify(publicContext).includes('fixture-only'), false);
});
