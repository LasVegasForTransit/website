import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { enqueueOperation } from '@lasvegasfortransit/platform-storage/outbox';
import { GoogleGroups } from '../src/google-groups';
import {
  configuration,
  directory,
  groupEmail,
  userId,
  userEmail,
} from './support/google-directory';

async function fixture() {
  const loaded = await import('../src/google-runner').catch(() => null);
  assert.ok(loaded, 'verified Workspace work needs a bounded provider dispatcher');
  const db = memoryDb();
  const people = new PersonService(db);
  const add = async (options: {
    id: string;
    externalId: string;
    externalEmail: string;
    linkMethod?: 'self_linked' | 'verified_email';
    membership?: 'member' | 'former_member';
  }) => {
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: `${options.id}@example.invalid` },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    await people.linkIdentity(person.id, {
      platform: 'google_workspace',
      externalId: options.externalId,
      externalEmail: options.externalEmail,
      linkMethod: options.linkMethod ?? 'self_linked',
    });
    const stamp = '2026-10-09T12:00:00.000Z';
    await db
      .prepare("UPDATE committees SET workspace_group_email=? WHERE id='events'")
      .bind(groupEmail)
      .run();
    await db
      .prepare(
        "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES(?,?,'events','member',?,?,?)",
      )
      .bind(`assignment-${options.id}`, person.id, stamp, person.id, stamp)
      .run();
    if (options.membership === 'former_member')
      await db
        .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
        .bind(person.id)
        .run();
    await db
      .prepare(
        "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'person',1) ON CONFLICT(person_id,target_id) DO NOTHING",
      )
      .bind(person.id)
      .run();
    const generation = await db
      .prepare(
        "SELECT generation FROM reconcile_generations WHERE person_id=? AND target_id='person'",
      )
      .bind(person.id)
      .first<{ generation: number }>();
    await enqueueOperation(db, {
      id: `job-${options.id}`,
      kind: 'person_reconcile',
      personId: person.id,
      targetId: 'person',
      generation: generation?.generation ?? 1,
      payload: {},
    });
    return person;
  };
  const remote = directory();
  return {
    ...loaded,
    db,
    add,
    remote,
    client: new GoogleGroups(configuration, remote.tokens, { fetch: remote.fetch }),
  };
}

void test('the Google dispatcher confirms verified work without completing the shared outbox', async () => {
  const { db, add, client, remote, reconcileGooglePending } = await fixture();
  await add({ id: 'member', externalId: userId, externalEmail: userEmail });
  await add({
    id: 'inferred',
    externalId: `${userId}2`,
    externalEmail: 'inferred@lasvegasfortransit.org',
    linkMethod: 'verified_email',
  });

  const result = await reconcileGooglePending(db, { client });

  assert.deepEqual(result, {
    selected: 1,
    confirmed: 1,
    retry: 0,
    partial: 0,
    busy: 0,
    notReady: 0,
    stale: 0,
    paused: false,
  });
  assert.equal(remote.state.direct, true);
  assert.equal(
    (await db.prepare("SELECT state FROM integration_outbox WHERE id='job-member'").first())?.state,
    'queued',
  );
  assert.equal(
    (await db.prepare("SELECT state FROM integration_outbox WHERE id='job-inferred'").first())
      ?.state,
    'queued',
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM provider_operation_receipts WHERE provider='google_workspace'",
        )
        .first()
    )?.n,
    1,
  );

  const next = await reconcileGooglePending(db, { client });
  assert.equal(next.selected, 0, 'a fresh Google receipt must not be repeated');
});

void test('the Google dispatcher still selects former members so their linked access is removed', async () => {
  const { db, add, client, remote, reconcileGooglePending } = await fixture();
  await add({
    id: 'former',
    externalId: userId,
    externalEmail: userEmail,
    membership: 'former_member',
  });
  remote.state.direct = true;

  const result = await reconcileGooglePending(db, { client });

  assert.equal(result.confirmed, 1);
  assert.equal(remote.state.direct, false);
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM provider_operation_receipts WHERE provider='google_workspace'")
        .first()
    )?.state,
    'done',
  );
});

void test('a saved Google quota pause prevents the dispatcher from selecting more accounts', async () => {
  const { db, add, client, remote, reconcileGooglePending } = await fixture();
  await add({ id: 'member', externalId: userId, externalEmail: userEmail });

  const result = await reconcileGooglePending(db, {
    client,
    rateLimit: { current: () => Promise.resolve(90_000) },
  });

  assert.equal(result.paused, true);
  assert.equal(result.selected, 0);
  assert.equal(remote.calls.length, 0);
});

void test('the Google dispatcher does not start a retry before its saved deadline', async () => {
  const { db, add, client, remote, reconcileGooglePending } = await fixture();
  await add({ id: 'member', externalId: userId, externalEmail: userEmail });
  await db
    .prepare(
      "UPDATE integration_outbox SET state='retry',next_attempt_at='2026-10-09T13:00:00.000Z' WHERE id='job-member'",
    )
    .run();

  const result = await reconcileGooglePending(db, {
    client,
    now: () => new Date('2026-10-09T12:00:00.000Z'),
  });

  assert.equal(result.selected, 0);
  assert.equal(remote.calls.length, 0);
});
