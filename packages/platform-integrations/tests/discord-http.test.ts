import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordHttp } from '../src/discord-http';
void test('the default transport preserves the Worker global fetch receiver', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = function (this: unknown, input) {
    assert.equal(this, globalThis);
    assert.equal(typeof input, 'string');
    assert.ok(typeof input === 'string');
    calls.push(input);
    return Promise.resolve(Response.json({ verified: true }));
  };
  try {
    const result = await new DiscordHttp().request('/users/@me', {
      authorization: 'Bearer fixture-only',
    });
    assert.deepEqual(result, { verified: true });
    assert.deepEqual(calls, ['https://discord.com/api/v10/users/@me']);
  } finally {
    globalThis.fetch = original;
  }
});
void test('edge requests use manual redirects and reject any redirect without forwarding credentials', async () => {
  const calls: string[] = [];
  const transport = new DiscordHttp({
    fetch: (input, init) => {
      assert.equal(init?.redirect, 'manual');
      assert.ok(typeof input === 'string');
      calls.push(input);
      return Promise.resolve(
        new Response(null, {
          status: 307,
          headers: { Location: 'https://attacker.example/collect' },
        }),
      );
    },
  });
  await assert.rejects(
    transport.request('/oauth2/token', {
      method: 'POST',
      authorization: 'Basic fixture-only',
      body: new URLSearchParams({ code: 'fixture-only' }),
    }),
    { kind: 'invalid_response' },
  );
  assert.deepEqual(calls, ['https://discord.com/api/v10/oauth2/token']);
});
