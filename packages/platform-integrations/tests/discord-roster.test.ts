import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import { claimDiscordScan } from '@lasvegasfortransit/platform-storage/discord-scan-store';
import { DiscordAccess, DiscordApiFailure, type DiscordGuildMember } from '../src/discord-access';

const guildId = '111111111111111111';
const memberRoleId = '333333333333333333';
const committeeRoleId = '444444444444444444';
const unrelatedRoleId = '555555555555555555';
const linkedUserId = '600000000000000000';
const reviewUserId = id(1);
const committeeUserId = id(1001);
const staleUserId = '800000000000000001';

async function fixture() {
  const loaded = await import('../src/discord-roster').catch(() => null);
  assert.ok(loaded, 'the scheduled scan must flag unlinked managed-role holders for staff review');
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'linked@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: linkedUserId,
    linkMethod: 'self_linked',
  });
  await db
    .prepare(
      "INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at) VALUES('civic-tech','discord',?,?)",
    )
    .bind(committeeRoleId, '2026-10-12T10:00:00.000Z')
    .run();
  return { ...loaded, db };
}

function id(index: number): string {
  return String(600000000000000000n + BigInt(index));
}

void test('guild review scan pages 2500 accounts, resumes a Discord rate limit, and never changes roles', async () => {
  const { db, scanDiscordGuildRoster } = await fixture();
  const members: DiscordGuildMember[] = Array.from({ length: 2500 }, (_, index) => ({
    id: id(index),
    roleIds:
      index === 0
        ? [memberRoleId, unrelatedRoleId]
        : index === 1
          ? [memberRoleId, unrelatedRoleId]
          : index === 1001
            ? [committeeRoleId]
            : index === 3
              ? [memberRoleId]
              : index === 4
                ? [unrelatedRoleId]
                : [],
    pending: false,
    bot: index === 3,
    username: `rider.${index}`,
    displayName: `Rider ${index}`,
    nickname: 'Server Rider',
  }));
  const calls: Array<string | undefined> = [];
  let limitOnce = true;
  const client = {
    configuration: { guildId },
    listGuildMembers: (after?: string) => {
      calls.push(after);
      if (after === id(999) && limitOnce) {
        limitOnce = false;
        throw new DiscordApiFailure('rate_limited', 2500);
      }
      const start =
        after === undefined ? 0 : members.findIndex((member) => member.id === after) + 1;
      return Promise.resolve(members.slice(start, start + 1000));
    },
  };
  const now = () => new Date('2026-10-12T10:00:00.000Z');
  const options = { client, memberRoleId, now };
  await db
    .prepare(
      'INSERT INTO discord_role_reviews(guild_id,discord_user_id,managed_role_ids,first_seen_at,last_seen_at,last_seen_scan_id) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      guildId,
      staleUserId,
      JSON.stringify([memberRoleId]),
      '2026-10-11T10:00:00.000Z',
      '2026-10-11T10:00:00.000Z',
      'previous-scan',
    )
    .run();

  const first = await scanDiscordGuildRoster(db, options);
  assert.deepEqual(first, { kind: 'scanned', scanned: 1000, flagged: 1, complete: false });
  assert.equal(
    (await db
      .prepare('SELECT 1 FROM discord_role_reviews WHERE discord_user_id=?')
      .bind(staleUserId)
      .first()) !== null,
    true,
    'partial scans must preserve the last complete review list',
  );
  const limited = await scanDiscordGuildRoster(db, options);
  assert.deepEqual(limited, { kind: 'retry', scanned: 0, flagged: 0, complete: false });
  const checkpoint = await db
    .prepare(
      "SELECT cursor,in_progress,errors FROM provider_scan_checkpoints WHERE provider='discord' AND context_id=?",
    )
    .bind(`guild-roster:${guildId}`)
    .first();
  assert.deepEqual(
    { ...checkpoint },
    {
      cursor: id(999),
      in_progress: 1,
      errors: 1,
    },
  );

  const second = await scanDiscordGuildRoster(db, options);
  assert.deepEqual(second, { kind: 'scanned', scanned: 1000, flagged: 1, complete: false });
  const third = await scanDiscordGuildRoster(db, options);
  assert.deepEqual(third, { kind: 'scanned', scanned: 500, flagged: 0, complete: true });
  assert.deepEqual(calls, [undefined, id(999), id(999), id(1999)]);

  const flags = await db
    .prepare(
      'SELECT discord_user_id,managed_role_ids FROM discord_role_reviews ORDER BY discord_user_id',
    )
    .all<{ discord_user_id: string; managed_role_ids: string }>();
  assert.deepEqual(
    flags.results.map((row) => [row.discord_user_id, JSON.parse(row.managed_role_ids) as string[]]),
    [
      [reviewUserId, [memberRoleId]],
      [committeeUserId, [committeeRoleId]],
    ],
  );
  assert.equal(
    flags.results.some((row) => row.discord_user_id === linkedUserId),
    false,
  );
  assert.equal(
    flags.results.some((row) => row.discord_user_id === staleUserId),
    false,
  );
  assert.equal(
    flags.results.some((row) => row.discord_user_id === id(0)),
    false,
  );
  const state = await db
    .prepare(
      "SELECT cursor,in_progress,pages_read,accounts_read,unlinked_role_accounts,errors,last_completed_at FROM provider_scan_checkpoints WHERE provider='discord' AND context_id=?",
    )
    .bind(`guild-roster:${guildId}`)
    .first();
  assert.deepEqual(
    { ...state },
    {
      cursor: null,
      in_progress: 0,
      pages_read: 3,
      accounts_read: 2500,
      unlinked_role_accounts: 2,
      errors: 1,
      last_completed_at: '2026-10-12T10:00:00.000Z',
    },
  );
  const named = await db
    .prepare(
      'SELECT username,display_name,nickname FROM discord_role_reviews WHERE discord_user_id=?',
    )
    .bind(reviewUserId)
    .first();
  assert.deepEqual(
    { ...named },
    {
      username: 'rider.1',
      display_name: 'Rider 1',
      nickname: 'Server Rider',
    },
  );
  db.raw.close();
});

void test('REST roster names fit the scheduled query budget and expired leases cannot replace them', async () => {
  const { db, scanDiscordGuildRoster } = await fixture();
  const budget = queryBudget(db, 50);
  let stamp = new Date('2026-10-12T10:00:00.000Z');
  let expire = false;
  const client = new DiscordAccess(
    {
      environment: 'preview',
      guildId,
      productionGuildId: '999999999999999999',
      botToken: 'fixture-only',
    },
    {
      fetch: async () => {
        if (expire) {
          stamp = new Date('2026-10-12T11:00:31.000Z');
          const successor = await claimDiscordScan(db, guildId, stamp, `guild-roster:${guildId}`);
          assert.equal(typeof successor, 'object');
        }
        return Response.json(
          Array.from({ length: 1000 }, (_, index) => ({
            user: {
              id: id(index),
              username: expire ? 'stale.name' : `rider.${index}`,
              global_name: 'Rider',
            },
            roles: [memberRoleId],
            pending: false,
            nick: 'Server Rider',
          })),
        );
      },
    },
  );
  const first = await scanDiscordGuildRoster(budget.db, { client, memberRoleId, now: () => stamp });
  assert.equal(first.kind, 'scanned');
  assert.equal(first.scanned, 1000);
  assert.equal(budget.queries <= 50, true);
  assert.equal(budget.largestBindings <= 100, true);
  const names = () =>
    db.raw
      .prepare(
        'SELECT username,display_name,nickname FROM discord_role_reviews WHERE discord_user_id=?',
      )
      .get(reviewUserId);
  assert.deepEqual(
    { ...names() },
    { username: 'rider.1', display_name: 'Rider', nickname: 'Server Rider' },
  );
  expire = true;
  stamp = new Date('2026-10-12T11:00:00.000Z');
  const stale = await scanDiscordGuildRoster(db, { client, memberRoleId, now: () => stamp });
  assert.equal(stale.kind, 'stale');
  assert.deepEqual(
    { ...names() },
    { username: 'rider.1', display_name: 'Rider', nickname: 'Server Rider' },
  );
  assert.equal(
    db.raw
      .prepare(
        'SELECT lease_token IS NOT NULL AS leased FROM provider_scan_checkpoints WHERE context_id=?',
      )
      .get(`guild-roster:${guildId}`)?.leased,
    1,
  );
  db.raw.close();
});
