import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceConnectorRequest } from '../src/workspace-connector-api';
import {
  fixture,
  send,
  consoleClaim,
  observation,
  directoryUser,
  now,
  audience,
  replyJson,
} from './support/workspace-protocol';
void test('connector admission rejects wrong Google principal, audience or issuer before enrollment', async () => {
  const f = await fixture();
  for (const override of [
    { subject: 'another-workload' },
    { audience: 'https://elsewhere.example' },
    { issuer: 'https://attacker.example' },
  ]) {
    const request = new Request(audience, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await f.token(override)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'enroll', account: {} }),
    });
    assert.equal(
      (await workspaceConnectorRequest(f.env, request, { fetch: f.fetcher, now: () => now }))
        .status,
      401,
    );
  }
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
});

void test('a verified connector can enroll only the approved preview account', async () => {
  const f = await fixture();
  const account = {
    customerId: 'C-lvbt',
    userId: 'google-test',
    email: 'test@lasvegasfortransit.org',
    givenName: 'Test',
    familyName: 'Volunteer',
    orgUnitId: 'ou-people',
    suspended: false,
    archived: false,
    deleted: false,
    observedAt: now.toISOString(),
  };
  async function send(userId: string) {
    return workspaceConnectorRequest(
      f.env,
      new Request(audience, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await f.token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enroll', account: { ...account, userId } }),
      }),
      { fetch: f.fetcher, now: () => now },
    );
  }
  assert.equal((await send('production-user')).status, 200);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  const result = await send('google-test');
  assert.equal(result.status, 200);
  assert.equal((await replyJson(result)).kind, 'enrolled');
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
});

void test('connector rejects an oversized body and unrecognized action without writing', async () => {
  const f = await fixture();
  for (const body of [
    JSON.stringify({ action: 'sql', sql: 'SELECT * FROM people' }),
    'x'.repeat(65537),
  ]) {
    const result = await workspaceConnectorRequest(
      f.env,
      new Request(audience, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await f.token()}`, 'Content-Type': 'application/json' },
        body,
      }),
      { fetch: f.fetcher, now: () => now },
    );
    assert.ok([400, 413].includes(result.status));
  }
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
});

void test('Console admission is confirmed only after exact-account group readback', async () => {
  const f = await fixture(),
    claim = await consoleClaim(f);
  assert.deepEqual(claim.plan.groups, [
    { resourceId: 'console-preview@lasvegasfortransit.org', desired: true },
  ]);
  assert.equal((await send(f, 'finish', { token: claim.token })).status, 409);
  assert.equal(
    (
      await send(f, 'observed', {
        token: claim.token,
        observation: { ...observation(claim), groupEmail: 'console-users@lasvegasfortransit.org' },
      })
    ).status,
    409,
  );
  assert.equal(
    (await send(f, 'observed', { token: claim.token, observation: observation(claim) })).status,
    200,
  );
  assert.equal((await send(f, 'finish', { token: claim.token })).status, 200);
  assert.equal(
    f.db.raw.prepare('SELECT console_state FROM workspace_enrollments').get()?.console_state,
    'granted',
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  assert.equal(
    f.db.raw.prepare('SELECT console_due_at FROM workspace_directory_accounts').get()
      ?.console_due_at,
    new Date(now.getTime() + 86400000).toISOString(),
  );
});

void test('suspension invalidates a claimed grant and queues Console removal', async () => {
  const f = await fixture(),
    claim = await consoleClaim(f);
  const later = new Date(now.getTime() + 1000);
  await send(
    f,
    'enroll',
    { account: { ...directoryUser, suspended: true, observedAt: later.toISOString() } },
    later,
  );
  assert.equal(
    (await send(f, 'observed', { token: claim.token, observation: observation(claim) }, later))
      .status,
    409,
  );
  const response = await send(f, 'claim', {}, later);
  assert.equal(response.status, 200);
  const removal = await replyJson(response);
  assert.deepEqual(removal.plan.groups, [
    { resourceId: 'console-preview@lasvegasfortransit.org', desired: false },
  ]);
});

void test('committee groups follow explicit assignments and stale receipts cannot confirm a removed assignment', async () => {
  const f = await fixture(),
    base = await consoleClaim(f);
  await send(f, 'observed', { token: base.token, observation: observation(base) });
  await send(f, 'finish', { token: base.token });
  const person = base.plan.personId;
  assert.ok(person);
  f.db.raw.prepare("UPDATE people SET membership_status='member' WHERE id=?").run(person);
  f.db.raw
    .prepare(
      "UPDATE committees SET workspace_group_email='committee-preview@lasvegasfortransit.org' WHERE id='events'",
    )
    .run();
  f.db.raw
    .prepare(
      "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES('assigned',?,'events','member',?,?,?)",
    )
    .run(person, now.toISOString(), person, now.toISOString());
  const result = await send(f, 'claim');
  assert.equal(result.status, 200);
  const claim = await replyJson(result);
  assert.equal(claim.plan.kind, 'committee');
  assert.deepEqual(claim.plan.groups, [
    { resourceId: 'committee-preview@lasvegasfortransit.org', desired: true },
  ]);
  f.db.raw
    .prepare(
      "UPDATE committee_assignments SET ended_at=?,end_reason='stepped_back' WHERE id='assigned'",
    )
    .run(now.toISOString());
  assert.equal(
    (await send(f, 'observed', { token: claim.token, observation: observation(claim) })).status,
    409,
  );
});
