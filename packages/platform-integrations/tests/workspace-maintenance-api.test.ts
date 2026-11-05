import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, send, now, directoryUser } from './support/workspace-protocol';
function object(value: unknown) {
  assert.ok(value && typeof value === 'object');
  return value as Record<string, unknown>;
}
void test('maintenance reports only due watch events and preserves scan/channel lease fences', async () => {
  const f = await fixture();
  await send(f, 'channelRegister', {
    id: 'add.live',
    event: 'add',
    tokenHash: 'a'.repeat(43),
    expiresAt: new Date(now.getTime() + 3600000).toISOString(),
  });
  await send(f, 'channelConfirm', {
    id: 'add.live',
    resourceId: 'add-resource',
    expiresAt: new Date(now.getTime() + 3600000).toISOString(),
  });
  await send(f, 'channelRegister', {
    id: 'update.pending',
    event: 'update',
    tokenHash: 'b'.repeat(43),
    expiresAt: new Date(now.getTime() + 3600000).toISOString(),
  });
  const response = await send(f, 'maintenance');
  assert.equal(response.status, 200);
  const first = object(await response.json()),
    scan = object(first.scan);
  assert.deepEqual(first.events, ['delete', 'undelete']);
  assert.equal(first.groupsDue, false);
  assert.equal(scan.phase, 'active');
  assert.equal(typeof scan.token, 'string');
  const second = object(await (await send(f, 'maintenance')).json());
  assert.deepEqual(second.events, ['delete', 'undelete']);
  assert.equal(object(second.scan).kind, 'idle');
  await send(f, 'channelConfirm', {
    id: 'add.live',
    resourceId: 'add-resource',
    expiresAt: new Date(now.getTime() + 240000).toISOString(),
  });
  const nearExpiry = object(await (await send(f, 'maintenance')).json());
  assert.deepEqual(nearExpiry.events, ['add', 'delete', 'undelete']);
  const oldProof = object(
    await (
      await send(f, 'channelValidate', {
        id: 'add.live',
        resourceId: 'add-resource',
        event: 'add',
        tokenHash: 'a'.repeat(43),
      })
    ).json(),
  );
  assert.equal(oldProof.valid, true);
  const later = new Date(now.getTime() + 121000);
  const retried = object(await (await send(f, 'maintenance', {}, later)).json());
  assert.deepEqual(retried.events, ['add', 'update', 'delete', 'undelete']);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM workspace_connector_claims').get()?.n,
    0,
  );
});
void test('maintenance honors the customer Google pause before claiming any scan or provider work', async () => {
  const f = await fixture();
  await send(f, 'backoff', { retryAfterMs: 120000 });
  const response = await send(f, 'maintenance');
  assert.equal(response.status, 200);
  const result = object(await response.json());
  assert.deepEqual(result.events, []);
  assert.equal(object(result.scan).kind, 'idle');
  assert.equal(result.retryAfterMs, 120000);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM workspace_directory_scans').get()?.n, 0);
});

void test('maintenance signals due group work without acquiring its mutation lease', async () => {
  const f = await fixture();
  await send(f, 'enroll', { account: directoryUser });
  const reply = object(await (await send(f, 'maintenance')).json());
  assert.equal(reply.groupsDue, true);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM workspace_connector_claims').get()?.n,
    0,
  );
  assert.equal(
    f.db.raw.prepare('SELECT console_lease FROM workspace_directory_accounts').get()?.console_lease,
    null,
  );
});
