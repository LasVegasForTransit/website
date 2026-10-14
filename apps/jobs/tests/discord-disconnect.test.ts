import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';

void test('private disconnect dispatch accepts only its fixed POST endpoint and bounded valid input', async (t) => {
  const loaded = await import('../src/discord-disconnect').catch(() => null);
  assert.ok(loaded, 'private jobs must dispatch confirmed Discord disconnections');
  const db = memoryDb();
  t.after(() => db.raw.close());
  const env = { PLATFORM_DB: db, LVBT_DEPLOYMENT_ENV: 'preview' };
  const body = JSON.stringify({
    personId: 'fixture',
    operationId: 'disconnect-fixture',
    environment: 'preview',
  });
  const request = (
    url = 'https://jobs.internal/discord/disconnect',
    value = body,
    method = 'POST',
  ) =>
    new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: value } : {}),
    });
  assert.equal(
    (
      await loaded.handleDiscordDisconnectRequest(
        request('https://public.example/discord/disconnect'),
        env,
      )
    ).status,
    404,
  );
  assert.equal(
    (await loaded.handleDiscordDisconnectRequest(request(undefined, body, 'GET'), env)).status,
    404,
  );
  assert.equal(
    (await loaded.handleDiscordDisconnectRequest(request(undefined, 'x'.repeat(8193)), env)).status,
    400,
  );
  assert.equal(
    (await loaded.handleDiscordDisconnectRequest(request(undefined, '{}'), env)).status,
    400,
  );
  const response = await loaded.handleDiscordDisconnectRequest(request(), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { kind: 'retry' });
});
