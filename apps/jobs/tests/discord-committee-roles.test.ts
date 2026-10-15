import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
const guildId = '111111111111111111',
  appId = '222222222222222222',
  botId = '333333333333333333',
  botRole = '444444444444444444',
  memberRole = '555555555555555555',
  eventsRole = '666666666666666666',
  leadRole = '777777777777777777';
async function fixture() {
  const module = await import('../src/discord-committee-roles').catch(() => null);
  assert.ok(module, 'committee settings need a private administrator role selection service');
  const db = memoryDb(),
    people = new PersonService(db);
  const person = (
    await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'role-admin@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    })
  ).person;
  db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(person.id, 'fixture', new Date().toISOString());
  const env = {
    PLATFORM_DB: db,
    LVBT_DEPLOYMENT_ENV: 'preview',
    LVBT_DISCORD_SYNC_ENABLED: 'true',
    LVBT_DISCORD_APPLICATION_ID: appId,
    LVBT_DISCORD_GUILD_ID: guildId,
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
    LVBT_DISCORD_MEMBER_ROLE_ID: memberRole,
    LVBT_DISCORD_BOT_TOKEN: 'fixture-token',
  };
  const roles = [
    { id: guildId, name: '@everyone', position: 0, permissions: '0', managed: false },
    { id: botRole, name: 'LVBT Bot', position: 10, permissions: '268435457', managed: true },
    { id: memberRole, name: 'LVBT Member', position: 1, permissions: '0', managed: false },
    { id: eventsRole, name: 'Events', position: 2, permissions: '0', managed: false },
    { id: leadRole, name: 'Events leads', position: 3, permissions: '0', managed: false },
  ];
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.method, 'GET');
    calls.push(input instanceof Request ? input.url : input.toString());
    const url = input instanceof Request ? input.url : input.toString();
    return await Promise.resolve(
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
  const base = { actorId: person.id, committeeId: 'events', guildId };
  const settings = {
    description: 'Community events',
    timeCommitment: 'Two hours a month',
    acceptingMembers: true,
    workspaceGroupEmail: null,
    discordRoleId: eventsRole,
    discordLeadRoleId: leadRole,
    interestIds: ['events'],
    expectedVersion: 1,
    operationId: 'choose-roles',
  };
  const request = (input: unknown, url = 'https://jobs.internal/discord/committee-roles') =>
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  return { ...module, db, env, roles, calls, fetcher, base, settings, request };
}
void test('private role selection requires a current administrator and makes no Discord request while disabled', async () => {
  const f = await fixture();
  try {
    for (const input of [
      { ...f.base, actorId: 'unknown', action: 'list' },
      { ...f.base, actorId: 'unknown', action: 'save', settings: f.settings },
    ])
      assert.equal(
        (await f.handleDiscordCommitteeRolesRequest(f.request(input), f.env, { fetch: f.fetcher }))
          .status,
        403,
      );
    assert.equal(
      (
        await f.handleDiscordCommitteeRolesRequest(
          f.request(
            { ...f.base, action: 'list' },
            'https://public.invalid/discord/committee-roles',
          ),
          f.env,
          { fetch: f.fetcher },
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.handleDiscordCommitteeRolesRequest(
          f.request({ ...f.base, action: 'save', settings: f.settings }),
          { ...f.env, LVBT_DISCORD_SYNC_ENABLED: 'false' },
          { fetch: f.fetcher },
        )
      ).status,
      503,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.db.raw.close();
  }
});
void test('save rechecks role hierarchy after rendering and cannot save a now-unassignable or forged role', async () => {
  const f = await fixture();
  try {
    const listed = await f.handleDiscordCommitteeRolesRequest(
      f.request({ ...f.base, action: 'list' }),
      f.env,
      { fetch: f.fetcher },
    );
    assert.equal(listed.status, 200);
    assert.ok(!(await listed.clone().text()).includes('fixture-token'));
    const lead = f.roles.find((r) => r.id === leadRole);
    assert.ok(lead);
    lead.position = 11;
    assert.equal(
      (
        await f.handleDiscordCommitteeRolesRequest(
          f.request({ ...f.base, action: 'save', settings: f.settings }),
          f.env,
          { fetch: f.fetcher },
        )
      ).status,
      400,
    );
    assert.equal(
      f.db.raw.prepare("SELECT settings_version FROM committees WHERE id='events'").get()
        ?.settings_version,
      1,
    );
    lead.position = 3;
    assert.equal(
      (
        await f.handleDiscordCommitteeRolesRequest(
          f.request({
            ...f.base,
            action: 'save',
            settings: { ...f.settings, discordRoleId: memberRole },
          }),
          f.env,
          { fetch: f.fetcher },
        )
      ).status,
      400,
    );
    const saved = await f.handleDiscordCommitteeRolesRequest(
      f.request({ ...f.base, action: 'save', settings: f.settings }),
      f.env,
      { fetch: f.fetcher },
    );
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal(
      f.db.raw.prepare("SELECT discord_lead_role_id FROM committees WHERE id='events'").get()
        ?.discord_lead_role_id,
      leadRole,
    );
    assert.match(saved.headers.get('Cache-Control') ?? '', /no-store/);
  } finally {
    f.db.raw.close();
  }
});
void test('an administrator revoked while Discord responds cannot save or receive role choices', async () => {
  const f = await fixture();
  try {
    const fetcher: typeof fetch = async (input, init) => {
      const r = await f.fetcher(input, init);
      if ((input instanceof Request ? input.url : input.toString()).endsWith('/roles'))
        f.db.raw
          .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
          .run(f.base.actorId);
      return r;
    };
    assert.equal(
      (
        await f.handleDiscordCommitteeRolesRequest(
          f.request({ ...f.base, action: 'save', settings: f.settings }),
          f.env,
          { fetch: fetcher },
        )
      ).status,
      403,
    );
    assert.equal(
      f.db.raw.prepare("SELECT settings_version FROM committees WHERE id='events'").get()
        ?.settings_version,
      1,
    );
  } finally {
    f.db.raw.close();
  }
});
