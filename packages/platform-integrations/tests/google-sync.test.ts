import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { enqueueOperation } from '@lasvegasfortransit/platform-storage/outbox';
import { GoogleGroups } from '../src/google-groups';
import {
  configuration,
  address,
  directory,
  groupEmail,
  userId,
  userEmail,
} from './support/google-directory';

async function fixture() {
  const loaded = await import('../src/google-sync').catch(() => null);
  assert.ok(
    loaded,
    'Google reconciliation must save guarded observations and provider-specific receipts',
  );
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'google_workspace',
    externalId: userId,
    externalEmail: userEmail,
    linkMethod: 'self_linked',
  });
  const stamp = new Date().toISOString();
  await db
    .prepare("UPDATE committees SET workspace_group_email=? WHERE id='events'")
    .bind(groupEmail)
    .run();
  await db
    .prepare(
      "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES('google-assignment',?,'events','member',?,?,?)",
    )
    .bind(person.id, stamp, person.id, stamp)
    .run();
  await db
    .prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'person',1)",
    )
    .bind(person.id)
    .run();
  await enqueueOperation(db, {
    id: 'google-fixture',
    kind: 'person_reconcile',
    personId: person.id,
    targetId: 'person',
    generation: 1,
    payload: {},
  });
  const remote = directory();
  return {
    ...loaded,
    db,
    people,
    person,
    remote,
    client: new GoogleGroups(configuration, remote.tokens, { fetch: remote.fetch }),
  };
}
void test('Google proof and access-change history come from actual reads without completing Discord or mailing work', async () => {
  const { db, client, syncGoogleOperation } = await fixture();
  assert.deepEqual(await syncGoogleOperation(db, 'google-fixture', { client }), {
    kind: 'confirmed',
  });
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM provider_operation_receipts WHERE provider='google_workspace'")
        .first()
    )?.state,
    'done',
  );
  assert.equal(
    (await db.prepare("SELECT state FROM integration_outbox WHERE id='google-fixture'").first())
      ?.state,
    'queued',
  );
  const proof = await db
    .prepare(
      "SELECT state,expected_access,resource_id FROM access_observations WHERE provider='google_workspace'",
    )
    .first();
  assert.equal(proof?.state, 'granted');
  assert.equal(proof.expected_access, 1);
  assert.equal(proof.resource_id, groupEmail);
  const audit = await db
    .prepare("SELECT actor_id,details FROM staff_audits WHERE action='access.granted'")
    .first<{ actor_id: string; details: string }>();
  assert.equal(audit?.actor_id, 'platform:google_workspace');
  const details = JSON.parse(audit.details) as { proof: string };
  assert.equal(details.proof, 'provider_read');
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM provider_access_intents').first())?.n,
    0,
  );
});
void test('mapping changes during a remote grant prevent stale proof and completion', async () => {
  const { db, person, remote, syncGoogleOperation } = await fixture();
  const client = new GoogleGroups(configuration, remote.tokens, {
    fetch: async (input, init) => {
      const response = await remote.fetch(input, init);
      if (init?.method === 'POST') {
        await db
          .prepare("UPDATE committees SET workspace_group_email=NULL WHERE id='events'")
          .run();
        await db
          .prepare(
            "UPDATE reconcile_generations SET generation=2 WHERE person_id=? AND target_id='person'",
          )
          .bind(person.id)
          .run();
      }
      return response;
    },
  });
  assert.deepEqual(await syncGoogleOperation(db, 'google-fixture', { client }), { kind: 'stale' });
  assert.equal((await db.prepare('SELECT count(*) AS n FROM access_observations').first())?.n, 0);
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM provider_operation_receipts').first())?.n,
    0,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.granted'")
        .first()
    )?.n,
    0,
  );
});
void test('concurrent Google jobs for one linked account are serialized', async () => {
  const { db, remote, syncGoogleOperation } = await fixture();
  let entered: () => void = () => undefined,
    release: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = new GoogleGroups(configuration, remote.tokens, {
    fetch: async (input, init) => {
      entered();
      await held;
      return await remote.fetch(input, init);
    },
  });
  const first = syncGoogleOperation(db, 'google-fixture', { client });
  await started;
  assert.deepEqual(await syncGoogleOperation(db, 'google-fixture', { client }), { kind: 'busy' });
  release();
  assert.deepEqual(await first, { kind: 'confirmed' });
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM provider_account_leases').first())?.n,
    0,
  );
});
void test('Google retry timing and unknown access survive a failure and block an early retry', async () => {
  const { db, remote, syncGoogleOperation } = await fixture();
  const client = new GoogleGroups(configuration, remote.tokens, {
    fetch: () =>
      Promise.resolve(
        Response.json({ error: { code: 429 } }, { status: 429, headers: { 'Retry-After': '90' } }),
      ),
  });
  assert.deepEqual(await syncGoogleOperation(db, 'google-fixture', { client }), {
    kind: 'retry',
    failure: 'rate_limited',
    retryAfterMs: 90000,
  });
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM access_observations WHERE provider='google_workspace'")
        .first()
    )?.state,
    'unknown',
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT failure FROM provider_operation_receipts WHERE provider='google_workspace'",
        )
        .first()
    )?.failure,
    'rate_limited',
  );
  assert.deepEqual(await syncGoogleOperation(db, 'google-fixture', { client }), { kind: 'stale' });
});
void test('cleared mappings are removed from the retained registry without retaining personal email', async () => {
  const { db, remote, person, syncGoogleOperation, client } = await fixture();
  remote.state.direct = true;
  await db
    .prepare(
      "INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at) VALUES('events','google_workspace',?,?)",
    )
    .bind(groupEmail, new Date().toISOString())
    .run();
  await db.prepare("UPDATE committees SET workspace_group_email=NULL WHERE id='events'").run();
  await db
    .prepare(
      "UPDATE identities SET external_email=NULL WHERE person_id=? AND platform='google_workspace'",
    )
    .bind(person.id)
    .run();
  assert.deepEqual(await syncGoogleOperation(db, 'google-fixture', { client }), {
    kind: 'confirmed',
  });
  assert.equal(remote.state.direct, false);
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.revoked'")
        .first()
    )?.n,
    1,
  );
});
void test('the current roster owns the plan; orphaned, unverified or multiply linked identities are not ready', async () => {
  const { db, person, syncGoogleOperation, client } = await fixture();
  await db
    .prepare(
      "UPDATE identities SET link_method='verified_email' WHERE person_id=? AND platform='google_workspace'",
    )
    .bind(person.id)
    .run();
  assert.deepEqual(await syncGoogleOperation(db, 'google-fixture', { client }), {
    kind: 'not_ready',
  });
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM provider_operation_receipts').first())?.n,
    0,
  );
});

void test('a lease for another Google account cannot save this person’s failure or overwrite its proof', async () => {
  const { db, person } = await fixture();
  const { loadGooglePlan } = await import('@lasvegasfortransit/platform-storage/google-plan');
  const { saveGoogleReceipt } =
    await import('@lasvegasfortransit/platform-storage/google-sync-store');
  const plan = await loadGooglePlan(db, {
    personId: person.id,
    operationId: 'google-fixture',
    customerId: 'Cfixture',
  });
  assert.ok(plan);
  const now = new Date();
  const lease = { customerId: 'Cfixture', identityId: 'another-account', token: 'another-lease' };
  await db
    .prepare("INSERT INTO provider_account_leases VALUES('google_workspace',?,?,?,?)")
    .bind(
      lease.customerId,
      lease.identityId,
      lease.token,
      new Date(now.getTime() + 30000).toISOString(),
    )
    .run();
  assert.equal(
    await saveGoogleReceipt(
      db,
      { plan, lease, now },
      { kind: 'permission_denied', retryAfterMs: 60000, resourceId: groupEmail },
    ),
    false,
  );
  assert.equal((await db.prepare('SELECT count(*) AS n FROM access_observations').first())?.n, 0);
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM provider_operation_receipts').first())?.n,
    0,
  );
});
void test('per-group checkpoints resume bounded work and stale checkpoints cannot survive a revised assignment', async () => {
  const { db, person, remote, syncGoogleOperation } = await fixture();
  const historical = 'preview-retired@lasvegasfortransit.org';
  await db
    .prepare(
      "INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at) VALUES('events','google_workspace',?,?)",
    )
    .bind(historical, new Date().toISOString())
    .run();
  const retired = directory();
  retired.state.group = { ...retired.state.group, email: historical, id: 'retired-group' };
  retired.state.direct = true;
  const fetcher: typeof fetch = (input, init) => {
    const url = address(input);
    if (url.includes(encodeURIComponent(historical)))
      return Promise.resolve(Response.json(retired.state.group));
    if (url.includes('/retired-group/'))
      return retired.fetch(url.replace('/retired-group/', '/group-advocacy/'), init);
    return remote.fetch(input, init);
  };
  const client = new GoogleGroups(
    { ...configuration, managedGroups: [historical, groupEmail] },
    remote.tokens,
    { fetch: fetcher },
  );
  let clock = new Date('2026-10-10T12:00:00.000Z');
  const options = { client, maxGroups: 1, now: () => clock };
  assert.deepEqual(await syncGoogleOperation(db, 'google-fixture', options), {
    kind: 'partial',
  });
  assert.equal(retired.state.direct, false);
  assert.equal(remote.state.direct, false, 'revocations precede grants');
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM provider_operation_receipts WHERE state='done'")
        .first()
    )?.n,
    0,
  );
  clock = new Date('2026-10-10T11:59:59.000Z');
  assert.deepEqual(
    await syncGoogleOperation(db, 'google-fixture', options),
    { kind: 'stale' },
    'a future-dated checkpoint cannot supply current proof',
  );
  clock = new Date('2026-10-10T12:04:59.000Z');
  assert.deepEqual(await syncGoogleOperation(db, 'google-fixture', options), {
    kind: 'confirmed',
  });
  assert.equal(
    (
      await db
        .prepare(
          "SELECT expires_at FROM provider_operation_receipts WHERE provider='google_workspace'",
        )
        .first()
    )?.expires_at,
    '2026-10-10T12:05:00.000Z',
    'the account receipt cannot extend the oldest group proof',
  );
  assert.equal(remote.state.direct, true);
  await db
    .prepare("UPDATE committee_assignments SET ended_at=?,end_reason='removed' WHERE person_id=?")
    .bind(new Date().toISOString(), person.id)
    .run();
  clock = new Date('2026-10-10T12:05:01.000Z');
  assert.deepEqual(await syncGoogleOperation(db, 'google-fixture', options), {
    kind: 'partial',
  });
  assert.deepEqual(await syncGoogleOperation(db, 'google-fixture', options), {
    kind: 'confirmed',
  });
  assert.equal(remote.state.direct, false);
});
