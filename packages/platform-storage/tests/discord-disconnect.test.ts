import assert from 'node:assert/strict';
import test from 'node:test';
import { createSession, endSession } from '../src/auth';
import { PersonService } from '../src/person-service';
import { loadDiscordPlan } from '../src/discord-plan';
import { discordJoinIsCurrent } from '../src/discord-join';
import { DiscordLinkService } from '../src/discord-link';
import { claimDiscordLease } from '../src/discord-sync-store';
import { memoryDb } from './support/db';

const origin = 'https://lasvegasfortransit.org';
const discordId = '222222222222222222';
async function fixture(t: test.TestContext) {
  const loaded = await import('../src/discord-disconnect').catch(() => null);
  assert.ok(loaded, 'members need a guarded Discord disconnect intent');
  const db = memoryDb();
  t.after(() => db.raw.close());
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only-secret' };
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'disconnect@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: discordId,
    linkMethod: 'self_linked',
  });
  const identity = await db
    .prepare("SELECT id FROM identities WHERE person_id=? AND platform='discord'")
    .bind(person.id)
    .first<{ id: string }>();
  assert.ok(identity);
  const session = await createSession(env, person.id, 'member');
  const input = {
    sessionToken: session.token,
    origin,
    identityRecordId: identity.id,
    operationId: 'disconnect-fixture',
    now: new Date(),
  };
  return { ...loaded, db, env, people, person, identity, session, input };
}

void test('disconnect invalidates earlier access work, preserves membership and blocks linking until cleanup', async (t) => {
  const { beginDiscordDisconnect, db, env, person, session, identity, input } = await fixture(t);
  const links = new DiscordLinkService(env);
  const started = await links.begin({ sessionToken: session.token, origin });
  assert.ok(started);
  const claim = await links.claim({ sessionToken: session.token, origin, state: started.state });
  assert.ok(claim);
  await db
    .prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'events',1)",
    )
    .bind(person.id)
    .run();
  await db
    .prepare(
      "INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at) VALUES('earlier-committee','committee_reconcile',?,'events',1,'{}',?,?,?)",
    )
    .bind(person.id, input.now.toISOString(), input.now.toISOString(), input.now.toISOString())
    .run();
  const result = await beginDiscordDisconnect(env, input);
  assert.equal(result?.personId, person.id);
  assert.equal(result.operationId, input.operationId);
  assert.equal(await discordJoinIsCurrent(db, { personId: person.id, discordId }), false);
  assert.equal(await links.begin({ sessionToken: session.token, origin }), null);
  assert.equal(
    await links.complete({
      claim,
      identity: { id: discordId, username: 'member', displayName: null, avatar: null },
    }),
    'failed',
  );
  const plan = await loadDiscordPlan(db, {
    personId: person.id,
    guildId: '111111111111111111',
    memberRoleId: '333333333333333333',
    operationId: input.operationId,
  });
  assert.ok(plan);
  assert.deepEqual(plan.desiredRoleIds, []);
  assert.equal(
    (await db.prepare('SELECT membership_status FROM people WHERE id=?').bind(person.id).first())
      ?.membership_status,
    'member',
  );
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM identities WHERE id=?').bind(identity.id).first())
      ?.n,
    1,
  );
  assert.equal((await db.prepare('SELECT count(*) AS n FROM consent_records').first())?.n, 1);
  assert.deepEqual(await beginDiscordDisconnect(env, input), result);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM integration_outbox WHERE json_extract(payload,'$.source')='discord_disconnect'",
        )
        .first()
    )?.n,
    2,
  );
  assert.equal(
    (await db.prepare("SELECT state FROM integration_outbox WHERE id='earlier-committee'").first())
      ?.state,
    'superseded',
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM integration_outbox WHERE person_id=? AND target_id='events' AND generation=2 AND state='queued'",
        )
        .bind(person.id)
        .first()
    )?.n,
    1,
  );
});

void test('a stale confirmation cannot affect a replacement identity or an expired session', async (t) => {
  const { beginDiscordDisconnect, db, env, session, input } = await fixture(t);
  assert.equal(
    await beginDiscordDisconnect(env, { ...input, origin: 'https://evil.example' }),
    null,
  );
  assert.equal(
    await beginDiscordDisconnect(env, { ...input, identityRecordId: 'another-identity' }),
    null,
  );
  await endSession(env, session.token);
  assert.equal(await beginDiscordDisconnect(env, input), null);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM discord_disconnects').first())?.n, 0);
});

void test('unlinking requires a fresh successful provider receipt, even when a caller supplies empty roles', async (t) => {
  const f = await fixture(t);
  assert.ok(await f.beginDiscordDisconnect(f.env, f.input));
  const plan = await loadDiscordPlan(f.db, {
    personId: f.person.id,
    guildId: '111111111111111111',
    memberRoleId: '333333333333333333',
    operationId: f.input.operationId,
  });
  assert.ok(plan);
  const lease = await claimDiscordLease(f.db, plan, f.input.now);
  assert.ok(lease);
  assert.equal(
    await f.finishDiscordDisconnect(f.db, {
      operationId: f.input.operationId,
      plan,
      lease,
      now: f.input.now,
      member: null,
    }),
    false,
  );
  assert.equal(
    (
      await f.db
        .prepare('SELECT count(*) AS n FROM identities WHERE id=?')
        .bind(f.identity.id)
        .first()
    )?.n,
    1,
  );
});

void test('the account still shows a personal Discord connection after membership ends', async (t) => {
  const f = await fixture(t);
  await f.people.withdrawConsent(f.person.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal((await new DiscordLinkService(f.env).profile(f.session.token))?.linked, true);
});
