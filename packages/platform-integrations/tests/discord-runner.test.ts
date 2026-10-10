import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { enqueueOperation } from '@lasvegasfortransit/platform-storage/outbox';
const configuration = {
  environment: 'preview' as const,
  guildId: '111111111111111111',
  productionGuildId: '999999999999999999',
  botToken: 'fixture-only',
};
const applicationId = '555555555555555555';
const memberRoleId = '333333333333333333';
async function fixture() {
  const loaded = await import('../src/discord-runner').catch(() => null);
  assert.ok(loaded, 'pending Discord work must run from a bounded scheduled dispatcher');
  const db = memoryDb(),
    people = new PersonService(db);
  const add = async (id: string, linkMethod: 'self_linked' | 'verified_email' = 'self_linked') => {
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: `${id}@example.invalid` },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    await people.linkIdentity(person.id, { platform: 'discord', externalId: id, linkMethod });
    await db
      .prepare(
        "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'person',1)",
      )
      .bind(person.id)
      .run();
    await enqueueOperation(db, {
      id: `job-${id}`,
      kind: 'person_reconcile',
      personId: person.id,
      targetId: 'person',
      generation: 1,
      payload: {},
    });
    return person;
  };
  return { ...loaded, db, people, add };
}
void test('the dispatcher grants current members, confirms actual roles and avoids repeating fresh confirmations', async () => {
  const { db, add, reconcileDiscordPending } = await fixture();
  const id = '222222222222222222';
  await add(id);
  await add('444444444444444444', 'verified_email');
  const roles = new Set<string>(),
    calls: string[] = [];
  const fetcher: typeof fetch = (input, init) => {
    assert.ok(typeof input === 'string');
    calls.push(input);
    if (init?.method === 'PUT') {
      roles.add(memberRoleId);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(
      Response.json({
        user: { id, username: 'member', avatar: null },
        roles: [...roles],
        pending: false,
        nick: null,
      }),
    );
  };
  const options = { configuration, applicationId, memberRoleId, fetch: fetcher };
  const run = await reconcileDiscordPending(db, options);
  assert.equal(run.confirmed, 1);
  assert.equal(run.selected, 1, 'email-inferred accounts cannot be synced');
  assert.equal(calls.length, 3);
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM provider_operation_receipts WHERE provider='discord'")
        .first()
    )?.state,
    'done',
  );
  const second = await reconcileDiscordPending(db, options);
  assert.equal(second.selected, 0);
  assert.equal(calls.length, 3);
  assert.equal(
    (await db.prepare('SELECT state FROM integration_outbox WHERE id=?').bind(`job-${id}`).first())
      ?.state,
    'queued',
    'other provider work remains unproven',
  );
});
void test('a global rate limit stops later accounts and a fresh dispatcher stays paused', async () => {
  const { db, add, reconcileDiscordPending } = await fixture();
  await add('222222222222222222');
  await add('444444444444444444');
  let calls = 0;
  const fetcher: typeof fetch = () => {
    calls += 1;
    return Promise.resolve(Response.json({ retry_after: 120, global: true }, { status: 429 }));
  };
  const options = { configuration, applicationId, memberRoleId, fetch: fetcher };
  const first = await reconcileDiscordPending(db, options);
  assert.equal(first.retry, 1);
  assert.equal(first.paused, true);
  const next = await reconcileDiscordPending(db, options);
  assert.equal(next.paused, true);
  assert.equal(next.selected, 0);
  assert.equal(calls, 1);
});
void test('a failed provider read does not prevent another member from being reconciled', async () => {
  const { db, add, reconcileDiscordPending } = await fixture();
  await add('222222222222222222');
  const id = '444444444444444444';
  await add(id);
  const fetcher: typeof fetch = (input) => {
    assert.ok(typeof input === 'string');
    return Promise.resolve(
      input.includes('222222222222222222')
        ? new Response(null, { status: 503 })
        : Response.json({
            user: { id, username: 'member', avatar: null },
            roles: [memberRoleId],
            pending: false,
            nick: null,
          }),
    );
  };
  const result = await reconcileDiscordPending(db, {
    configuration,
    applicationId,
    memberRoleId,
    fetch: fetcher,
  });
  assert.equal(result.retry, 1);
  assert.equal(result.confirmed, 1);
});
void test('never-confirmed members are processed before older confirmations that need refreshing', async () => {
  const { db, add, reconcileDiscordPending } = await fixture();
  const oldId = '222222222222222222';
  const newId = '444444444444444444';
  await add(oldId);
  await add(newId);
  await db
    .prepare(`UPDATE integration_outbox SET created_at='2026-01-01T00:00:00.000Z' WHERE id=?`)
    .bind(`job-${oldId}`)
    .run();
  await db
    .prepare(
      `INSERT INTO provider_operation_receipts(operation_id,provider,state,revision_hash,lease_token,observed_at,expires_at)
    VALUES (?,'discord','done','fixture','fixture','2026-01-01T00:00:00.000Z','2026-01-01T00:05:00.000Z')`,
    )
    .bind(`job-${oldId}`)
    .run();
  const calls: string[] = [];
  const fetcher: typeof fetch = (input) => {
    assert.ok(typeof input === 'string');
    calls.push(input);
    const id = input.includes(newId) ? newId : oldId;
    return Promise.resolve(
      Response.json({
        user: { id, username: 'member', avatar: null },
        roles: [memberRoleId],
        pending: false,
        nick: null,
      }),
    );
  };
  await reconcileDiscordPending(db, {
    configuration,
    applicationId,
    memberRoleId,
    fetch: fetcher,
    limit: 1,
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.includes(newId),
    true,
    'oldest queued work must not repeatedly starve new linked members',
  );
});
