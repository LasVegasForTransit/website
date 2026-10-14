import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

const now = new Date('2026-10-14T12:00:00.000Z');
const secretText = 'newsletter-webhook-fixture-only';
const secret = `whsec_${btoa(secretText)}`;
const publicationId = 'pub_fixture';
const input = {
  event_type: 'subscription.confirmed',
  event_timestamp: 1791892800,
  uid: 'evt_fixture',
  data: {
    id: 'sub_fixture',
    email: 'Member@Example.Invalid',
    status: 'active',
    created: 1666800076,
    custom_fields: [{ name: 'private', value: 'not retained' }],
  },
};
async function receive() {
  const module = await import('../src/beehiiv-webhook').catch(() => null);
  assert.ok(module, 'newsletter events need an authenticated raw-body receiver');
  return module.readBeehiivWebhook;
}
function envelope(payload: unknown = input, timestamp = String(now.getTime() / 1000)) {
  const text = JSON.stringify(payload);
  const id = 'msg_delivery_fixture';
  const signature = createHmac('sha256', new TextEncoder().encode(secretText))
    .update(`${id}.${timestamp}.${text}`)
    .digest('base64');
  return {
    secret,
    publicationId,
    now,
    body: new TextEncoder().encode(text),
    headers: new Headers({
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    }),
  };
}

void test('verifies the published Svix vector without requiring a 32-byte secret', async () => {
  // Public reference vector: https://docs.svix.com/receiving/verifying-payloads/how-manual
  const read = await receive();
  const result = await read({
    secret: 'whsec_plJ3nmyCDGBKInavdOK15jsl',
    publicationId,
    now: new Date(1731705121000),
    body: new TextEncoder().encode('{"event_type":"ping","data":{"success":true}}'),
    headers: new Headers({
      'svix-id': 'msg_loFOjxBNrRLzqYUf',
      'svix-timestamp': '1731705121',
      'svix-signature': 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=',
    }),
  });
  assert.deepEqual(result, { kind: 'ignored' });
});
void test('retains provider event time and separate replay identifiers without unrelated member data', async () => {
  const read = await receive();
  assert.deepEqual(await read(envelope()), {
    kind: 'event',
    messageId: 'msg_delivery_fixture',
    event: {
      publicationId,
      id: 'evt_fixture',
      type: 'subscription.confirmed',
      occurredAt: '2026-10-13T12:00:00.000Z',
      subscriptionId: 'sub_fixture',
      email: 'member@example.invalid',
    },
  });
});
void test('authenticates the exact bytes before parsing even equivalent JSON', async () => {
  const read = await receive();
  const signed = envelope();
  signed.body = new TextEncoder().encode(JSON.stringify(input, null, 2));
  assert.deepEqual(await read(signed), { kind: 'invalid_signature' });
});
void test('rejects old, future, missing and malformed delivery authentication', async () => {
  const read = await receive();
  for (const time of [
    String(now.getTime() / 1000 - 301),
    String(now.getTime() / 1000 + 301),
    'NaN',
    '1.5',
  ])
    assert.deepEqual(await read(envelope(input, time)), { kind: 'invalid_signature' });
  for (const header of ['svix-id', 'svix-timestamp', 'svix-signature']) {
    const signed = envelope();
    signed.headers.delete(header);
    assert.deepEqual(await read(signed), { kind: 'invalid_signature' });
  }
  const wrongKey = envelope();
  wrongKey.secret = 'whsec_invalid';
  assert.deepEqual(await read(wrongKey), { kind: 'invalid_signature' });
});
void test('accepts a valid supported signature during rotation and rejects unsupported versions', async () => {
  const read = await receive();
  const signed = envelope();
  const signature = signed.headers.get('svix-signature');
  signed.headers.set('svix-signature', `v2,unrecognized v1,invalid ${signature}`);
  assert.equal((await read(signed)).kind, 'event');
  signed.headers.set('svix-signature', signature?.replace('v1,', 'v2,') ?? '');
  assert.deepEqual(await read(signed), { kind: 'invalid_signature' });
});
void test('does not mistake a deleted event’s active status or a pause for fresh consent', async () => {
  const read = await receive();
  const result = await read(envelope({ ...input, event_type: 'subscription.deleted' }));
  assert.equal(result.kind, 'event');
  assert.equal(result.event.type, 'subscription.deleted');
  assert.deepEqual(await read(envelope({ ...input, event_type: 'subscription.paused' })), {
    kind: 'ignored',
  });
});
void test('rejects incomplete source evidence and bounds authenticated payloads', async () => {
  const read = await receive();
  for (const change of [
    { uid: undefined },
    { event_timestamp: undefined },
    { event_timestamp: -1 },
    { event_timestamp: Number.MAX_SAFE_INTEGER },
    { data: { id: 'sub_fixture' } },
    { data: { ...input.data, email: 'not-an-address' } },
    { data: { ...input.data, id: '../other-resource' } },
  ])
    assert.deepEqual(await read(envelope({ ...input, ...change })), { kind: 'invalid_payload' });
  const oversized = envelope({ ...input, padding: 'x'.repeat(65_536) });
  assert.deepEqual(await read(oversized), { kind: 'too_large' });
});
