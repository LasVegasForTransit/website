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
  assert.deepEqual(scoped.items[0]?.roles, [{ id: eventsRoleId, label: 'Events Committee' }]);
  f.db.raw.close();
});
