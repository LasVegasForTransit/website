import assert from 'node:assert/strict';
import test from 'node:test';
import { runMaintenance } from '@lasvegasfortransit/platform-storage/retention';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import { loadDiscordPlan } from '@lasvegasfortransit/platform-storage/discord-plan';
import {
  claimDiscordLease,
  releaseDiscordLease,
} from '@lasvegasfortransit/platform-storage/discord-sync-store';
import { prepareDiscordChange } from '@lasvegasfortransit/platform-storage/discord-change-audit';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
import { beginDiscordDisconnect } from '@lasvegasfortransit/platform-storage/discord-disconnect';
import { pendingDiscordOperations } from '@lasvegasfortransit/platform-storage/discord-pending';
import { discordBudgetFixture, memberRoleId, unrelatedRoleId } from './support/discord-budget';

async function interruptedGrants(
  f: Awaited<ReturnType<typeof discordBudgetFixture>>,
  operationId = 'budget-fixture',
  wasGranted = false,
) {
  const plan = await loadDiscordPlan(f.db, {
    personId: f.person.id,
    guildId: '111111111111111111',
    memberRoleId,
    operationId,
  });
  assert.ok(plan);
  const lease = await claimDiscordLease(f.db, plan, f.now());
  assert.ok(lease);
  for (const resourceId of wasGranted ? plan.managedRoleIds : plan.desiredRoleIds)
    assert.equal(
      await prepareDiscordChange(
        f.db,
        { operationId, plan, lease, now: f.now() },
        { resourceId, wasGranted },
      ),
      true,
    );
  await releaseDiscordLease(f.db, lease);
}

void test('interrupted confirmations drain in bounded passes before marking the operation done', async (t) => {
  const f = await discordBudgetFixture(t, 24);
  await interruptedGrants(f);
  for (const id of [memberRoleId, ...f.roleIds]) f.roles.add(id);
  for (let pass = 0; pass < 25; pass++) {
    const result = await f.run();
    assert.equal(result.confirmed, Number(pass === 24));
    assert.equal(result.progress, Number(pass !== 24));
    assert.equal(f.changes.length, 0);
    assert.equal(
      f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.granted'").get()
        ?.n,
      pass + 1,
    );
  }
});
void test('confirmed server absence does not invent grants or endlessly retry unconfirmed old writes', async (t) => {
  const f = await discordBudgetFixture(t, 2);
  await interruptedGrants(f);
  f.state.absent = true;
  assert.equal((await f.run()).confirmed, 1);
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.granted'").get()
      ?.n,
    0,
  );
  assert.equal(f.db.raw.prepare('SELECT in_guild FROM discord_profiles').get()?.in_guild, 0);
});
void test('server absence drains interrupted removal confirmations without requiring a live profile', async (t) => {
  const f = await discordBudgetFixture(t, 24);
  await f.people.withdrawConsent(f.person.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: new Date().toISOString(),
  });
  const [operationId] = await pendingDiscordOperations(f.db, f.now(), 1);
  assert.ok(operationId);
  await interruptedGrants(f, operationId, true);
  f.state.absent = true;
  for (let pass = 0; pass < 25; pass++)
    assert.equal((await f.run()).confirmed, Number(pass === 24));
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.revoked'").get()
      ?.n,
    25,
  );
  assert.equal(f.changes.length, 0);
});
void test('rate limits during a bounded change retain the intent and resume without duplicate grants', async (t) => {
  const f = await discordBudgetFixture(t, 100);
  f.state.failure = true;
  const failed = await f.run();
  assert.equal(failed.retry, 1);
  assert.equal(failed.paused, true);
  assert.equal(f.changes.length, 0);
  f.state.failure = false;
  f.state.offset += 2000;
  for (let pass = 0; pass <= 100; pass++) await f.run();
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.granted'").get()
      ?.n,
    101,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM provider_access_intents').get()?.n, 0);
});

for (const count of [2, 100]) {
  void test(`${count} committee roles resume across bounded accounts without premature completion`, async (t) => {
    const f = await discordBudgetFixture(t, count);
    for (let pass = 0; pass <= count; pass++) {
      const before = f.changes.length;
      const result = await f.run();
      assert.equal(f.changes.length - before, 1);
      assert.equal(result.confirmed, Number(pass === count));
      assert.equal(result.progress, Number(pass !== count));
      assert.equal(
        f.db.raw
          .prepare(
            "SELECT count(*) AS n FROM provider_operation_receipts WHERE provider='discord' AND state='done'",
          )
          .get()?.n,
        Number(pass === count),
      );
      assert.equal(
        f.db.raw
          .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.granted'")
          .get()?.n,
        pass + 1,
      );
    }
    assert.deepEqual([...f.roles].sort(), [memberRoleId, unrelatedRoleId, ...f.roleIds].sort());
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM provider_access_intents').get()?.n, 0);
    assert.ok(
      Number(f.db.raw.prepare('SELECT count(*) AS n FROM access_observations').get()?.n) <=
        3 * (count + 1),
      'partial passes must not rewrite every committee snapshot',
    );
    const completed = await f.run();
    assert.equal(completed.selected, 0);
  });
}
void test('withdrawal after partial grants resumes only removal and preserves other roles', async (t) => {
  const f = await discordBudgetFixture(t, 100);
  assert.equal((await f.run()).progress, 1);
  await f.people.withdrawConsent(f.person.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal((await f.run()).confirmed, 1);
  assert.deepEqual([...f.roles], [unrelatedRoleId]);
  assert.equal(f.changes.filter((change) => change.startsWith('PUT')).length, 1);
});
void test('profile erasure after partial grants can finish after physical profile cleanup', async (t) => {
  const f = await discordBudgetFixture(t, 100);
  assert.equal((await f.run()).progress, 1);
  await f.people.deletePerson(f.person.id);
  const maintenance = queryBudget(f.db, 50);
  await runMaintenance(maintenance.db, {
    category: 'profiles',
    now: new Date(Date.now() + 31 * 86_400_000),
  });
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM people WHERE id=?').get(f.person.id)?.n,
    0,
  );
  assert.equal((await f.run()).confirmed, 1);
  assert.deepEqual([...f.roles], [unrelatedRoleId]);
  for (const table of ['discord_profiles', 'access_observations'])
    assert.equal(f.db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
});
void test('retired mappings are removed across bounded passes before current roles are added', async (t) => {
  const f = await discordBudgetFixture(t, 2);
  for (let index = 0; index < 25; index++) {
    const id = `9${String(index).padStart(17, '0')}`;
    f.roles.add(id);
    await f.db
      .prepare(
        "INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at) VALUES('events','discord',?,?)",
      )
      .bind(id, f.now().toISOString())
      .run();
  }
  for (let pass = 0; pass < 28; pass++) {
    assert.equal((await f.run()).confirmed, Number(pass === 27));
    assert.equal(f.changes.length, pass + 1);
  }
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.revoked'").get()
      ?.n,
    25,
  );
  assert.deepEqual([...f.roles].sort(), [memberRoleId, unrelatedRoleId, ...f.roleIds].sort());
});
void test('disconnect keeps the verified account until every managed role is confirmed absent', async (t) => {
  const f = await discordBudgetFixture(t, 100);
  for (const id of [memberRoleId, ...f.roleIds]) f.roles.add(id);
  const env = { PLATFORM_DB: f.db, LVBT_SIGN_IN_SECRET: 'fixture-only' };
  const session = await createSession(env, f.person.id, 'member');
  const identity = f.db.raw
    .prepare("SELECT id FROM identities WHERE person_id=? AND platform='discord'")
    .get(f.person.id);
  assert.ok(identity && typeof identity.id === 'string');
  assert.ok(
    await beginDiscordDisconnect(env, {
      sessionToken: session.token,
      origin: 'https://preview.lasvegasfortransit.org',
      identityRecordId: identity.id,
      operationId: 'bounded-disconnect',
      now: new Date(),
    }),
  );
  for (let pass = 0; pass <= 100; pass++) {
    const result = await f.run();
    assert.equal(result.confirmed, Number(pass === 100));
    assert.equal(
      f.db.raw.prepare("SELECT count(*) AS n FROM identities WHERE platform='discord'").get()?.n,
      Number(pass !== 100),
    );
  }
  assert.deepEqual([...f.roles], [unrelatedRoleId]);
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.revoked'").get()
      ?.n,
    101,
  );
  assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'member');
});
void test('an accepted write with no observed effect cannot count as progress', async (t) => {
  const f = await discordBudgetFixture(t, 100);
  f.state.ignoreWrites = true;
  const result = await f.run();
  assert.equal(result.retry, 1);
  assert.equal(result.progress, 0);
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.granted'").get()
      ?.n,
    0,
  );
});
