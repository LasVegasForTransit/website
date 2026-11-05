import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import {
  fixture,
  send,
  consoleClaim,
  observation,
  directoryUser,
  now,
  replyJson,
} from './support/workspace-protocol';
void test('notification channels renew only when due and validation is bound to their event and resource', async () => {
  const f = await fixture();
  const input = {
    id: 'channel-one',
    event: 'add',
    tokenHash: 'a'.repeat(43),
    expiresAt: new Date(now.getTime() + 3600000).toISOString(),
  };
  const first = await send(f, 'channelRegister', input);
  assert.equal(first.status, 200);
  assert.equal((await replyJson(first)).registered, true);
  await send(f, 'channelConfirm', {
    id: input.id,
    resourceId: 'resource-one',
    expiresAt: input.expiresAt,
  });
  const duplicate = await send(f, 'channelRegister', { ...input, id: 'channel-two' });
  assert.equal((await replyJson(duplicate)).registered, false);
  for (const [resourceId, tokenHash, event, want] of [
    ['resource-one', input.tokenHash, 'add', true],
    ['wrong', input.tokenHash, 'add', false],
    ['resource-one', 'b'.repeat(43), 'add', false],
    ['resource-one', input.tokenHash, 'delete', false],
  ] as const) {
    const result = await send(f, 'channelValidate', { id: input.id, resourceId, tokenHash, event });
    assert.equal((await replyJson(result)).valid, want);
  }
});

void test('recovery scan checkpoints are leased and a complete scan schedules the next cycle', async () => {
  const f = await fixture();
  const claim = await replyJson(await send(f, 'scanClaim'));
  assert.equal(claim.phase, 'active');
  assert.equal(claim.pageToken, null);
  assert.equal(claim.offset, 0);
  assert.equal((await replyJson(await send(f, 'scanClaim'))).kind, 'idle');
  assert.equal(
    (
      await send(f, 'scanSave', {
        token: claim.token,
        phase: 'deleted',
        pageToken: null,
        offset: 0,
        complete: false,
      })
    ).status,
    200,
  );
  const deleted = await replyJson(await send(f, 'scanClaim'));
  assert.equal(deleted.phase, 'deleted');
  assert.equal(
    (
      await send(f, 'scanSave', {
        token: claim.token,
        phase: 'deleted',
        pageToken: null,
        offset: 0,
        complete: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await send(f, 'scanSave', {
        token: deleted.token,
        phase: 'deleted',
        pageToken: null,
        offset: 0,
        complete: true,
      })
    ).status,
    200,
  );
  assert.equal((await replyJson(await send(f, 'scanClaim'))).kind, 'idle');
});

void test('Google quota backoff pauses only Google claims and never changes Discord pause state', async () => {
  const f = await fixture();
  await send(f, 'enroll', { account: directoryUser });
  assert.equal((await send(f, 'backoff', { retryAfterMs: 60000 })).status, 200);
  assert.equal((await replyJson(await send(f, 'claim'))).kind, 'idle');
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM provider_backoffs WHERE provider='discord'").get()
      ?.n,
    0,
  );
});

void test('erasure invalidates pending signed plans and their contact snapshots', async () => {
  const f = await fixture(),
    claim = await consoleClaim(f);
  assert.ok(claim.plan.personId);
  await new PersonService(f.db).deletePerson(claim.plan.personId);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM workspace_connector_claims').get()?.n,
    0,
  );
  assert.equal(
    (await send(f, 'observed', { token: claim.token, observation: observation(claim) })).status,
    409,
  );
});

void test('batch enrollment is bounded and preserves one result per approved account', async () => {
  const f = await fixture();
  const result = await send(f, 'enrollBatch', {
    accounts: [directoryUser, { ...directoryUser, userId: 'not-approved' }],
  });
  assert.equal(result.status, 200);
  assert.deepEqual(
    (await replyJson(result)).results.map((r) => r.kind),
    ['enrolled', 'excluded'],
  );
  assert.equal(
    (await send(f, 'enrollBatch', { accounts: Array.from({ length: 21 }, () => directoryUser) }))
      .status,
    400,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
});

void test('Google request budget refuses new work before consuming the protected provider allowance', async () => {
  const f = await fixture();
  await send(f, 'enroll', { account: directoryUser });
  assert.ok(
    f.db.raw
      .prepare("SELECT name FROM sqlite_master WHERE name='workspace_connector_budget'")
      .get(),
    'Google connector needs an independent daily budget',
  );
  f.db.raw.prepare('UPDATE workspace_connector_budget SET charged_reads=9999999').run();
  assert.equal((await send(f, 'claim')).status, 429);
  assert.equal(
    f.db.raw.prepare('SELECT console_lease FROM workspace_directory_accounts').get()?.console_lease,
    null,
  );
});

void test('a Google committee retry leaves the shared Discord operation immediately runnable', async () => {
  const f = await fixture(),
    base = await consoleClaim(f);
  await send(f, 'observed', { token: base.token, observation: observation(base) });
  await send(f, 'finish', { token: base.token });
  const person = base.plan.personId;
  f.db.raw.prepare("UPDATE people SET membership_status='member' WHERE id=?").run(person ?? null);
  f.db.raw
    .prepare(
      "UPDATE committees SET workspace_group_email='committee-preview@lasvegasfortransit.org' WHERE id='events'",
    )
    .run();
  f.db.raw
    .prepare(
      "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES('assigned',?,'events','member',?,?,?)",
    )
    .run(person ?? null, now.toISOString(), person ?? null, now.toISOString());
  const claim = await replyJson(await send(f, 'claim'));
  assert.equal(claim.plan.kind, 'committee');
  const before = f.db.raw
    .prepare('SELECT state,next_attempt_at FROM integration_outbox WHERE id=?')
    .get(claim.plan.operationId);
  assert.equal(
    (
      await send(f, 'finish', {
        token: claim.token,
        failure: { kind: 'permission_denied', retryAfterMs: 120000, resourceId: null },
      })
    ).status,
    200,
  );
  assert.deepEqual(
    f.db.raw
      .prepare('SELECT state,next_attempt_at FROM integration_outbox WHERE id=?')
      .get(claim.plan.operationId),
    before,
  );
  assert.equal(
    f.db.raw
      .prepare('SELECT failure FROM workspace_google_retries WHERE operation_id=?')
      .get(claim.plan.operationId)?.failure,
    'permission_denied',
  );
});
