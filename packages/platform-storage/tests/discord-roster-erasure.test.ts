import assert from 'node:assert/strict';
import test from 'node:test';
import { createSession } from '../src/auth';
import { beginDiscordDisconnect, finishDiscordDisconnect } from '../src/discord-disconnect';
import { loadDiscordPlan } from '../src/discord-plan';
import { claimDiscordLease, saveDiscordSync } from '../src/discord-sync-store';
import { claimDiscordScan } from '../src/discord-scan-store';
import { recordDiscordRosterPage } from '../src/discord-roster';
import { runMaintenance } from '../src/retention';
import { applyMigrations } from './support/db';
import { mergeFixture } from './support/merge-fixture';

const guildId = '111111111111111111';
const accountId = '222222222222222222';
const memberRoleId = '333333333333333333';

void test('an erased account cannot regain cached names after queued disconnect deletes its identity', async (t) => {
  const f = await mergeFixture();
  t.after(() => f.db.raw.close());
  await f.people.linkIdentity(f.survivor.id, {
    platform: 'discord',
    externalId: accountId,
    linkMethod: 'self_linked',
  });
  const env = { PLATFORM_DB: f.db, LVBT_SIGN_IN_SECRET: 'fixture-only' };
  const session = await createSession(env, f.survivor.id, 'member');
  const identity = f.db.raw.prepare("SELECT id FROM identities WHERE platform='discord'").get();
  assert.ok(identity);
  assert.ok(
    await beginDiscordDisconnect(env, {
      sessionToken: session.token,
      origin: 'https://lasvegasfortransit.org',
      identityRecordId: String(identity.id),
      operationId: 'erased-disconnect',
      now: new Date(),
    }),
  );
  await f.people.deletePerson(f.survivor.id);
  const now = new Date();
  const operation = f.db.raw
    .prepare(
      "SELECT o.id FROM integration_outbox o JOIN reconcile_generations g ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation WHERE o.person_id=? AND o.target_id='person' AND o.state='queued'",
    )
    .get(f.survivor.id);
  assert.ok(operation);
  const operationId = String(operation.id);
  const plan = await loadDiscordPlan(f.db, {
    personId: f.survivor.id,
    guildId,
    memberRoleId,
    operationId,
  });
  assert.ok(plan);
  const lease = await claimDiscordLease(f.db, plan, now);
  assert.ok(lease);
  const write = { operationId, plan, lease, now, member: null };
  assert.equal(await saveDiscordSync(f.db, write), true);
  assert.equal(await finishDiscordDisconnect(f.db, write), true);
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").get()?.n,
    0,
  );
  await runMaintenance(f.db, { now: new Date('2030-10-15T10:00:00.000Z') });
  assert.equal(f.db.raw.prepare('SELECT id FROM people WHERE id=?').get(f.survivor.id), undefined);
  const observe = async (date: string, hasRoles: boolean) => {
    const at = new Date(date);
    const scan = await claimDiscordScan(f.db, guildId, at, `guild-roster:${guildId}`);
    assert.notEqual(typeof scan, 'string');
    if (typeof scan === 'string') throw new Error(scan);
    await recordDiscordRosterPage(f.db, {
      scan,
      memberRoleId,
      now: at,
      members: [
        {
          id: accountId,
          username: 'erased.name',
          displayName: 'Erased Name',
          nickname: 'Private',
          roleIds: hasRoles ? [memberRoleId] : [],
          bot: false,
          pending: false,
        },
      ],
    });
  };
  await observe('2030-10-16T10:00:00.000Z', true);
  const names = () =>
    f.db.raw.prepare('SELECT username,display_name,nickname FROM discord_role_reviews').get();
  assert.deepEqual({ ...names() }, { username: null, display_name: null, nickname: null });
  await observe('2030-10-17T10:00:00.000Z', false);
  assert.equal(names(), undefined);
  await observe('2030-10-18T10:00:00.000Z', true);
  assert.deepEqual({ ...names() }, { username: null, display_name: null, nickname: null });
  assert.equal(
    f.db.raw.prepare('SELECT discord_user_id FROM discord_erased_accounts').get()?.discord_user_id,
    accountId,
  );
});

void test('the names migration preserves suppression for already erased Discord identities', async (t) => {
  const f = await mergeFixture('0045_scheduled_read_budget.sql');
  t.after(() => f.db.raw.close());
  await f.people.linkIdentity(f.survivor.id, {
    platform: 'discord',
    externalId: accountId,
    linkMethod: 'self_linked',
  });
  await f.people.deletePerson(f.survivor.id);
  applyMigrations(f.db.raw);
  assert.equal(
    f.db.raw.prepare('SELECT discord_user_id FROM discord_erased_accounts').get()?.discord_user_id,
    accountId,
  );
});
