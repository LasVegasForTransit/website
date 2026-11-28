import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from '../../../packages/platform-storage/tests/support/merge-fixture';
const guildId = '111111111111111111',
  appId = '222222222222222222',
  botId = '333333333333333333',
  botRole = '444444444444444444',
  memberRole = '555555555555555555',
  regionRole = '666666666666666666';
void test('private region settings use current administrator and live assignable roles, never forged or committee-owned choices', async (context) => {
  const module = await import('../src/discord-region-roles').catch(() => null);
  assert.ok(module, 'region settings require private provider-validated role selection');
  const f = await mergeFixture();
  context.after(() => f.db.raw.close());
  const env = {
    PLATFORM_DB: f.db,
    LVBT_DEPLOYMENT_ENV: 'preview',
    LVBT_DISCORD_SYNC_ENABLED: 'true',
    LVBT_DISCORD_APPLICATION_ID: appId,
    LVBT_DISCORD_GUILD_ID: guildId,
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
    LVBT_DISCORD_MEMBER_ROLE_ID: memberRole,
    LVBT_DISCORD_BOT_TOKEN: 'fixture-only',
  };
  const regionEntry = {
    id: regionRole,
    name: 'East Las Vegas',
    position: 2,
    permissions: '0',
    managed: false,
  };
  const roles = [
    { id: guildId, name: '@everyone', position: 0, permissions: '0', managed: false },
    { id: botRole, name: 'LVBT Bot', position: 10, permissions: '268435456', managed: true },
    { id: memberRole, name: 'LVBT Member', position: 1, permissions: '0', managed: false },
    regionEntry,
  ];
  let requests = 0;
  const fetcher: typeof fetch = (input) => {
    requests++;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(
      Response.json(
        url.endsWith('/applications/@me')
          ? { id: appId }
          : url.endsWith('/users/@me')
            ? { id: botId, bot: true }
            : url.endsWith(`/members/${botId}`)
              ? { user: { id: botId, bot: true }, roles: [botRole] }
              : roles,
      ),
    );
  };
  const request = (value: unknown, url = 'https://jobs.internal/discord/region-roles') =>
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  const base = { actorId: f.actor.personId, guildId };
  assert.equal(
    (
      await module.handleDiscordRegionRolesRequest(
        request({ ...base, actorId: f.survivor.id, action: 'list' }),
        env,
        { fetch: fetcher },
      )
    ).status,
    403,
  );
  assert.equal(requests, 0);
  const listed = await module.handleDiscordRegionRolesRequest(
    request({ ...base, action: 'list' }),
    env,
    { fetch: fetcher },
  );
  assert.equal(listed.status, 200);
  assert.match(await listed.text(), /East Las Vegas/);
  const settings = {
    regionId: 'east_las_vegas',
    roleId: regionRole,
    expectedVersion: 1,
    operationId: 'region-choice',
  };
  regionEntry.position = 11;
  assert.equal(
    (
      await module.handleDiscordRegionRolesRequest(
        request({ ...base, action: 'save', settings }),
        env,
        { fetch: fetcher },
      )
    ).status,
    400,
  );
  assert.equal(
    f.db.raw.prepare("SELECT discord_role_id FROM regions WHERE id='east_las_vegas'").get()
      ?.discord_role_id,
    null,
  );
  regionEntry.position = 2;
  assert.equal(
    (
      await module.handleDiscordRegionRolesRequest(
        request({ ...base, action: 'save', settings }),
        env,
        { fetch: fetcher },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await module.handleDiscordRegionRolesRequest(
        request({
          ...base,
          action: 'save',
          settings: { ...settings, regionId: 'summerlin', operationId: 'forged' },
        }),
        env,
        { fetch: fetcher },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await module.handleDiscordRegionRolesRequest(
        request({ ...base, action: 'list' }, 'https://public.invalid/discord/region-roles'),
        env,
        { fetch: fetcher },
      )
    ).status,
    404,
  );
});
