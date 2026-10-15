import assert from 'node:assert/strict';
import test from 'node:test';
const guildId = '111111111111111111';
const applicationId = '222222222222222222';
const botId = '333333333333333333';
const botRoleId = '444444444444444444';
const memberRoleId = '555555555555555555';
const role = (
  id: string,
  name: string,
  position: number,
  extra: { managed?: boolean; permissions?: string } = {},
) => ({
  id,
  name,
  position,
  managed: extra.managed ?? false,
  permissions: extra.permissions ?? '0',
});
const configuration = {
  environment: 'preview' as const,
  guildId,
  productionGuildId: '999999999999999999',
  botToken: 'fixture-token',
};
async function fixture() {
  const module = await import('../src/discord-role-catalog').catch(() => null);
  assert.ok(module, 'staff need current assignable Discord roles without receiving the bot token');
  const requests: string[] = [];
  const roles = [
    role(guildId, '@everyone', 0),
    role(botRoleId, 'LVBT Bot', 10, { managed: true, permissions: '268435457' }),
    role(memberRoleId, 'LVBT Member', 1),
    role('666666666666666666', 'Events', 2),
    role('777777777777777777', 'Above bot', 11),
    role('888888888888888888', 'Integration', 3, { managed: true }),
    role('121212121212121212', 'Equal position', 10),
  ];
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.method, 'GET');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bot fixture-token');
    const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
    requests.push(path);
    if (path.endsWith('/applications/@me'))
      return await Promise.resolve(Response.json({ id: applicationId }));
    if (path.endsWith('/users/@me'))
      return await Promise.resolve(Response.json({ id: botId, bot: true }));
    if (path.endsWith(`/members/${botId}`))
      return await Promise.resolve(
        Response.json({ user: { id: botId, bot: true }, roles: [botRoleId] }),
      );
    assert.ok(path.endsWith('/roles'));
    return await Promise.resolve(Response.json(roles));
  };
  return { ...module, requests, roles, fetcher };
}
void test('role choices exclude everyone, the member role, managed integrations and roles at or above the bot', async () => {
  const f = await fixture();
  const result = await f.readDiscordRoleCatalog(
    configuration,
    { applicationId, memberRoleId },
    { fetch: f.fetcher },
  );
  assert.deepEqual(
    result.filter((r) => r.assignable).map((r) => r.name),
    ['Events'],
  );
  assert.equal(f.requests.length, 4);
  assert.equal(
    result.some((r) => r.id === botRoleId && r.assignable),
    false,
  );
});
void test('wrong application identity, missing bot permissions and incomplete role inventories fail closed', async () => {
  const f = await fixture();
  await assert.rejects(
    f.readDiscordRoleCatalog(
      configuration,
      { applicationId: '232323232323232323', memberRoleId },
      { fetch: f.fetcher },
    ),
    { kind: 'invalid_response' },
  );
  const botRole = f.roles.find((r) => r.id === botRoleId);
  assert.ok(botRole);
  botRole.permissions = '1';
  await assert.rejects(
    f.readDiscordRoleCatalog(configuration, { applicationId, memberRoleId }, { fetch: f.fetcher }),
    { kind: 'permission_denied' },
  );
  f.roles.splice(
    f.roles.findIndex((r) => r.id === botRoleId),
    1,
  );
  await assert.rejects(
    f.readDiscordRoleCatalog(configuration, { applicationId, memberRoleId }, { fetch: f.fetcher }),
    { kind: 'invalid_response' },
  );
});
