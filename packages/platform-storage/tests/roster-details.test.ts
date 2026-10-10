import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { loadActor } from '../src/staff-roles';
import { searchStaffPeople } from '../src/staff-people';

void test('staff can find members who still need a committee assignment', async () => {
  const { db, actor, admin, survivor, merged, committees } = await mergeFixture();
  try {
    await committees.assign({
      personId: survivor.id,
      committeeId: 'events',
      role: 'member',
      actorId: admin.id,
      operationId: 'assigned',
    });
    const page = await searchStaffPeople(db, actor, {
      committeeId: 'unassigned',
      membershipStatus: 'member',
    });
    assert.deepEqual(page.items.map((person) => person.id).sort(), [admin.id, merged.id].sort());
  } finally {
    db.raw.close();
  }
});
void test('roster shows current committees and account linkage, and rechecks viewer scope', async () => {
  const { db, actor, admin, survivor, merged, committees } = await mergeFixture();
  const views = await import('../src/roster-details').catch(() => null);
  assert.ok(views, 'staff need to see who has a committee and a connected Discord account');
  try {
    const first = await committees.assign({
      personId: survivor.id,
      committeeId: 'events',
      role: 'member',
      actorId: admin.id,
      operationId: 'events',
    });
    assert.equal(first.kind, 'ok');
    await committees.assign({
      personId: merged.id,
      committeeId: 'events',
      role: 'lead',
      actorId: admin.id,
      operationId: 'lead',
    });
    db.raw
      .prepare(
        "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES ('discord',?,'discord','discord-account',?,'self_linked',?,?)",
      )
      .run(
        survivor.id,
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    const rows = await views.rosterDetails(db, actor, [survivor.id, merged.id]);
    assert.deepEqual(rows.get(survivor.id), {
      committees: ['Events Committee'],
      discordConnected: true,
      discordInServer: null,
      welcome: { claimedBy: null, claimedByName: null },
    });
    await committees.endAssignment(first.value.id, 'stepped_back', admin.id, 'end');
    assert.deepEqual(
      (await views.rosterDetails(db, actor, [survivor.id])).get(survivor.id)?.committees,
      [],
    );
    const lead = await loadActor(db, merged.id);
    assert.ok(lead);
    assert.equal((await views.rosterDetails(db, lead, [survivor.id])).size, 0);
    db.raw.prepare("UPDATE people SET membership_status='former_member' WHERE id=?").run(merged.id);
    assert.equal((await views.rosterDetails(db, lead, [merged.id])).size, 0);
  } finally {
    db.raw.close();
  }
});
void test('roster reports only fresh Discord server presence for the configured guild', async () => {
  const { db, actor, survivor } = await mergeFixture();
  const views = await import('../src/roster-details');
  try {
    const now = new Date('2026-10-09T20:00:00.000Z');
    await db
      .prepare(
        "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES ('discord',?,'discord','discord-account',?,'self_linked',?,?)",
      )
      .bind(survivor.id, now.toISOString(), now.toISOString(), now.toISOString())
      .run();
    await db
      .prepare(
        'INSERT INTO discord_profiles(identity_record_id,guild_id,username,display_name,avatar,nickname,in_guild,pending,observed_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        'discord',
        'configured-guild',
        'rider',
        'Rider',
        null,
        null,
        1,
        0,
        now.toISOString(),
        new Date(now.getTime() + 300_000).toISOString(),
      )
      .run();
    const configuration = { discord: { configured: true, contextId: 'configured-guild' } };
    const read = (config = configuration, at = now) =>
      views.rosterDetails(db, actor, [survivor.id], { configuration: config, now: at });
    assert.equal((await read()).get(survivor.id)?.discordInServer, true);
    await db.prepare('UPDATE discord_profiles SET in_guild=0').run();
    assert.equal((await read()).get(survivor.id)?.discordInServer, false);
    assert.equal(
      (await read({ discord: { configured: true, contextId: 'another-guild' } })).get(survivor.id)
        ?.discordInServer,
      null,
    );
    assert.equal(
      (await read(configuration, new Date(now.getTime() + 301_000))).get(survivor.id)
        ?.discordInServer,
      null,
    );
  } finally {
    db.raw.close();
  }
});
