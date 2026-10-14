import assert from 'node:assert/strict';
import test from 'node:test';
import { forwardBeehiivEvent } from '../functions/webhooks/beehiiv';
void test('the public endpoint forwards exact bytes and only signature headers to private jobs', async () => {
  const body = ' { "event_type" : "subscription.deleted" }\n';
  let calls = 0;
  const result = await forwardBeehiivEvent(
    new Request('https://lasvegasfortransit.org/webhooks/beehiiv', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'svix-id': 'msg_fixture',
        'svix-timestamp': '1',
        'svix-signature': 'v1,fixture',
        Cookie: 'private-cookie',
        Authorization: 'Bearer private-token',
      },
    }),
    {
      fetch: async (input) => {
        assert.ok(input instanceof Request);
        calls++;
        assert.equal(input.url, 'https://jobs.internal/newsletter/event');
        assert.equal(await input.text(), body);
        assert.equal(input.headers.get('svix-signature'), 'v1,fixture');
        assert.equal(input.headers.get('Cookie'), null);
        assert.equal(input.headers.get('Authorization'), null);
        return new Response('internal detail', { status: 200 });
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, 200);
  assert.equal(await result.text(), 'Received.');
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
});
void test('the public endpoint caps streamed bodies and never forwards a partial payload', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(40_000));
      controller.enqueue(new Uint8Array(40_000));
      controller.close();
    },
  });
  const request = new Request('https://lasvegasfortransit.org/webhooks/beehiiv', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
    duplex: 'half',
  } as RequestInit);
  assert.equal(
    (
      await forwardBeehiivEvent(request, {
        fetch: () => {
          assert.fail('oversized body must not reach jobs');
        },
      })
    ).status,
    413,
  );
});
