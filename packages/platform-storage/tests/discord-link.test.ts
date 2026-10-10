import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { createSession, endSession } from '../src/auth';
import { memoryDb } from './support/db';
const origin = 'https://lasvegasfortransit.org';
const identity = {
  id: '222222222222222222',
  username: 'verified.member',
  displayName: 'Verified Member',
  avatar: null,
};
async function fixture() {
  const loaded = await import('../src/discord-link').catch(() => null);
  assert.ok(
    loaded,
    'verified Discord linking must bind a one-use request to an existing member session',
  );
  const db = memoryDb(),
    env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only-secret' },
    people = new PersonService(db);
  const create = async (email: string) =>
    (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { email },
        consent: {
          scope: 'newsletter' as const,
          source: 'join_form' as const,
          method: 'checkbox' as const,
          wordingVersion: 'fixture',
        },
      })
    ).person;
  const person = await create('linked-member@example.invalid');
  const session = await createSession(env, person.id, 'member');
  const service = new loaded.DiscordLinkService(env);
  return { ...loaded, db, env, people, person, session, service, create };
}
void test('an existing member links a verified stable account once, preserving their membership and contact details', async () => {
  const { db, person, people, service, session } = await fixture();
  const started = await service.begin({ sessionToken: session.token, origin });
  assert.ok(started);
  const claim = await service.claim({ state: started.state, sessionToken: session.token, origin });
  assert.ok(claim);
  assert.equal(await service.complete({ claim, identity }), true);
  assert.equal(await service.complete({ claim, identity }), false);
  assert.equal(
    await service.claim({ state: started.state, sessionToken: session.token, origin }),
    null,
  );
  const link = await db
    .prepare(
      "SELECT external_id,link_method FROM identities WHERE person_id=? AND platform='discord'",
    )
    .bind(person.id)
    .first();
  assert.equal(link?.external_id, identity.id);
  assert.equal(link.link_method, 'self_linked');
  assert.equal((await people.getPerson(person.id))?.email, 'linked-member@example.invalid');
  assert.equal(
    (await db.prepare('SELECT count(*) AS count FROM consent_records').first())?.count,
    1,
  );
  assert.equal(
    (await db.prepare('SELECT username FROM discord_identity_profiles').first())?.username,
    identity.username,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS count FROM integration_outbox WHERE kind='person_reconcile'")
        .first()
    )?.count,
    1,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS count FROM staff_audits WHERE action='identity.discord_link'")
        .first()
    )?.count,
    1,
  );
});
void test('state cannot be claimed by another session, another origin, or after expiry', async () => {
  const { service, session, person, env } = await fixture();
  const second = await createSession(env, person.id, 'member');
  const now = new Date();
  const started = await service.begin({ sessionToken: session.token, origin, now });
  assert.ok(started);
  assert.equal(
    await service.claim({ state: started.state, sessionToken: second.token, origin, now }),
    null,
  );
  assert.equal(
    await service.claim({
      state: started.state,
      sessionToken: session.token,
      origin: 'https://preview.lasvegasfortransit.org',
      now,
    }),
    null,
  );
  assert.equal(
    await service.claim({
      state: started.state,
      sessionToken: session.token,
      origin,
      now: new Date(now.getTime() + 600_000),
    }),
    null,
  );
});
void test('withdrawal or sign-out while Discord is verifying cannot create a link or queued grant', async () => {
  for (const action of ['withdraw', 'sign_out']) {
    const { service, session, person, env, people, db } = await fixture();
    const started = await service.begin({ sessionToken: session.token, origin });
    assert.ok(started);
    const claim = await service.claim({
      state: started.state,
      sessionToken: session.token,
      origin,
    });
    assert.ok(claim);
    if (action === 'withdraw')
      await people.withdrawConsent(person.id, {
        scope: 'newsletter',
        source: 'member',
        withdrawnAt: new Date().toISOString(),
      });
    else await endSession(env, session.token);
    assert.equal(await service.complete({ claim, identity }), false);
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) AS count FROM identities WHERE platform='discord'")
          .first()
      )?.count,
      0,
    );
    assert.equal(
      (await db.prepare('SELECT count(*) AS count FROM integration_outbox').first())?.count,
      0,
    );
  }
});
void test('two members cannot link the same account, and a new authorization does not replace an existing different account', async () => {
  const { service, session, person, env, db, create } = await fixture();
  const other = await create('other-member@example.invalid'),
    otherSession = await createSession(env, other.id, 'member');
  const claims = await Promise.all(
    [session, otherSession].map(async (item) => {
      const start = await service.begin({ sessionToken: item.token, origin });
      assert.ok(start);
      const claim = await service.claim({ state: start.state, sessionToken: item.token, origin });
      assert.ok(claim);
      return claim;
    }),
  );
  const result = await Promise.all(
    claims.map(async (claim) => await service.complete({ claim, identity })),
  );
  assert.equal(result.filter(Boolean).length, 1);
  const owner = await db
    .prepare("SELECT person_id FROM identities WHERE platform='discord'")
    .first<{ person_id: string }>();
  assert.ok(owner);
  const token = owner.person_id === person.id ? session.token : otherSession.token;
  const start = await service.begin({ sessionToken: token, origin });
  assert.ok(start);
  const claim = await service.claim({ state: start.state, sessionToken: token, origin });
  assert.ok(claim);
  assert.equal(
    await service.complete({ claim, identity: { ...identity, id: '333333333333333333' } }),
    false,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS count FROM identities WHERE person_id=? AND platform='discord'",
        )
        .bind(owner.person_id)
        .first()
    )?.count,
    1,
  );
});
void test('unknown, nonmember, ambiguous and forbidden-origin sessions cannot begin linking', async () => {
  const { service, session, person, people, db } = await fixture();
  assert.equal(await service.begin({ sessionToken: 'invalid', origin }), null);
  assert.equal(
    await service.begin({ sessionToken: session.token, origin: 'https://attacker.example' }),
    null,
  );
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: identity.id,
    linkMethod: 'self_linked',
  });
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: '333333333333333333',
    linkMethod: 'self_linked',
  });
  assert.equal(await service.begin({ sessionToken: session.token, origin }), null);
  await db.prepare("DELETE FROM identities WHERE platform='discord'").run();
  await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal(await service.begin({ sessionToken: session.token, origin }), null);
  assert.equal(
    (await db.prepare('SELECT count(*) AS count FROM discord_link_states').first())?.count,
    0,
  );
});

void test('audit failure rolls back the identity, profile and queued access together', async () => {
  const { db, service, session } = await fixture();
  const started = await service.begin({ sessionToken: session.token, origin });
  assert.ok(started);
  const claim = await service.claim({ state: started.state, sessionToken: session.token, origin });
  assert.ok(claim);
  db.raw.exec(`CREATE TRIGGER reject_discord_audit BEFORE INSERT ON staff_audits
    WHEN NEW.action='identity.discord_link' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END`);
  await assert.rejects(service.complete({ claim, identity }), /fixture audit failure/);
  for (const table of [
    'identities',
    'discord_identity_profiles',
    'integration_outbox',
    'reconcile_generations',
  ])
    assert.equal((await db.prepare(`SELECT count(*) AS count FROM ${table}`).first())?.count, 0);
  assert.equal(
    (await db.prepare('SELECT completed_at FROM discord_link_states').first())?.completed_at,
    null,
  );
  db.raw.exec('DROP TRIGGER reject_discord_audit');
  assert.equal(await service.complete({ claim, identity }), true);
});
void test('linking replaces outstanding person and committee work with the new account generation', async () => {
  const { db, service, session, person } = await fixture();
  db.raw
    .prepare(
      `INSERT INTO reconcile_generations(person_id,target_id,generation)
    VALUES (?,'person',3),(?,'fixture-committee',7)`,
    )
    .run(person.id, person.id);
  db.raw
    .prepare(
      `INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,state,next_attempt_at,created_at,updated_at)
    VALUES ('old-person','person_reconcile',?,'person',3,'{}','running',?,?,?),
    ('old-committee','committee_reconcile',?,'fixture-committee',7,'{}','retry',?,?,?)`,
    )
    .run(
      person.id,
      ...Array.from({ length: 3 }, () => new Date().toISOString()),
      person.id,
      ...Array.from({ length: 3 }, () => new Date().toISOString()),
    );
  const started = await service.begin({ sessionToken: session.token, origin });
  assert.ok(started);
  const claim = await service.claim({ state: started.state, sessionToken: session.token, origin });
  assert.ok(claim);
  assert.equal(await service.complete({ claim, identity }), true);
  const rows = (
    await db
      .prepare(
        'SELECT target_id,generation,state FROM integration_outbox ORDER BY target_id,generation',
      )
      .all()
  ).results;
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [
      { target_id: 'fixture-committee', generation: 7, state: 'superseded' },
      { target_id: 'fixture-committee', generation: 8, state: 'queued' },
      { target_id: 'person', generation: 3, state: 'superseded' },
      { target_id: 'person', generation: 4, state: 'queued' },
    ],
  );
});
