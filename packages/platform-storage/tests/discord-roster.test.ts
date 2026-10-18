import assert from 'node:assert/strict';
import test from 'node:test';
import { loadActor } from '../src/staff-roles';
import { mergeFixture } from './support/merge-fixture';

const guildId = '111111111111111111';
const memberRoleId = '333333333333333333';
const eventsRoleId = '444444444444444444';
const advocacyRoleId = '555555555555555555';

void test('Discord role review shows admins all flags and committee leads only their managed roles', async () => {
  const loaded = await import('../src/discord-roster').catch(() => null);
  assert.ok(loaded, 'staff need a scoped list of unlinked Discord role holders to review');
  const f = await mergeFixture();
  const stamp = '2026-10-12T10:00:00.000Z';
  await f.db
    .prepare(
      "INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at) VALUES('events','discord',?,?),('advocacy','discord',?,?)",
    )
    .bind(eventsRoleId, stamp, advocacyRoleId, stamp)
    .run();
  const flags: Array<[string, string[]]> = [
    ['700000000000000001', [memberRoleId, eventsRoleId, advocacyRoleId]],
    ['700000000000000002', [memberRoleId]],
  ];
  for (const [discordId, roles] of flags) {
    await f.db
      .prepare(
        'INSERT INTO discord_role_reviews(guild_id,discord_user_id,managed_role_ids,first_seen_at,last_seen_at,last_seen_scan_id) VALUES(?,?,?,?,?,?)',
      )
      .bind(guildId, discordId, JSON.stringify(roles), stamp, stamp, stamp)
      .run();
  }
  await f.db
    .prepare(
      "UPDATE discord_role_reviews SET username='events.rider',display_name='Events Rider' WHERE discord_user_id='700000000000000001'",
    )
    .run();
  await f.db
    .prepare(
      "UPDATE discord_role_reviews SET username='private.member' WHERE discord_user_id='700000000000000002'",
    )
    .run();
  const admin = await loaded.listDiscordRoleReviews(f.db, f.actor, {
    guildId,
    memberRoleId,
  });
  assert.equal(admin.items.length, 2);
  assert.deepEqual(
    admin.items[0]?.roles.map((role: { label: string }) => role.label),
    ['LVBT Member', 'Advocacy Team', 'Events Committee'],
  );

  const leadPerson = await f.create('events-lead@example.invalid', 'Events Lead');
  await f.committees.assign({
    personId: leadPerson.id,
    committeeId: 'events',
    role: 'lead',
    actorId: f.admin.id,
    operationId: 'events-lead',
  });
  const lead = await loadActor(f.db, leadPerson.id);
  assert.ok(lead);
  const scoped = await loaded.listDiscordRoleReviews(f.db, lead, {
    guildId,
    memberRoleId,
  });
  assert.equal(scoped.items.length, 1);
  assert.equal(scoped.items[0]?.username, 'events.rider');
  assert.equal(JSON.stringify(scoped).includes('private.member'), false);
  assert.deepEqual(scoped.items[0].roles, [{ id: eventsRoleId, label: 'Events Committee' }]);
  f.db.raw.close();
});

void test('review names refresh and stay erased after the personal profile is purged', async () => {
  const { recordDiscordRosterPage, listDiscordRoleReviews } = await import('../src/discord-roster');
  const { claimDiscordScan } = await import('../src/discord-scan-store');
  const { runMaintenance } = await import('../src/retention');
  const f = await mergeFixture();
  const accountId = '700000000000000003';
  const stamp = new Date('2026-10-12T10:00:00.000Z');
  const observe = async (username: string, now: Date) => {
    const scan = await claimDiscordScan(f.db, guildId, now, `guild-roster:${guildId}`);
    assert.equal(typeof scan, 'object');
    if (typeof scan === 'string') throw new Error(scan);
    await recordDiscordRosterPage(f.db, {
      scan,
      memberRoleId,
      now,
      members: [
        {
          id: accountId,
          roleIds: [memberRoleId],
          bot: false,
          pending: false,
          username,
          displayName: 'Rider',
          nickname: 'Server Rider',
        },
      ],
    });
  };
  await observe('rider.first', stamp);
  let page = await listDiscordRoleReviews(f.db, f.actor, { guildId, memberRoleId });
  assert.equal(page.items[0]?.username, 'rider.first');
  assert.equal(page.items[0].nickname, 'Server Rider');
  await observe('rider.renamed', new Date('2026-10-13T10:00:00.000Z'));
  page = await listDiscordRoleReviews(f.db, f.actor, { guildId, memberRoleId });
  assert.equal(page.items[0]?.username, 'rider.renamed');
  assert.equal(page.items[0].firstSeenAt, stamp.toISOString());
  await f.people.linkIdentity(f.survivor.id, {
    platform: 'discord',
    externalId: accountId,
    linkMethod: 'self_linked',
  });
  assert.equal(
    (await listDiscordRoleReviews(f.db, f.actor, { guildId, memberRoleId })).items.length,
    0,
  );
  await f.people.deletePerson(f.survivor.id);
  const names = () =>
    f.db.raw
      .prepare(
        'SELECT username,display_name,nickname FROM discord_role_reviews WHERE discord_user_id=?',
      )
      .get(accountId);
  assert.deepEqual({ ...names() }, { username: null, display_name: null, nickname: null });
  await runMaintenance(f.db, { now: new Date('2030-10-15T10:00:00.000Z') });
  assert.equal(f.db.raw.prepare('SELECT id FROM people WHERE id=?').get(f.survivor.id), undefined);
  await observe('must.not.return', new Date('2030-10-16T10:00:00.000Z'));
  assert.deepEqual({ ...names() }, { username: null, display_name: null, nickname: null });
  page = await listDiscordRoleReviews(f.db, f.actor, { guildId, memberRoleId });
  assert.deepEqual(page.items[0]?.roles, [{ id: memberRoleId, label: 'LVBT Member' }]);
  assert.equal(page.items[0].username, null);
  f.db.raw.close();
});
