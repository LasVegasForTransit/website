import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordApiFailure } from '../src/discord-types';
const userId = '111111111111111111',
  guildId = '222222222222222222',
  channelId = '333333333333333333',
  messageId = '444444444444444444';
const card = {
  flags: 32768,
  allowed_mentions: { parse: [] as never[] },
  components: [{ type: 17, components: [{ type: 10, content: 'Task' }] }],
};
async function clientModule() {
  const module = await import('../src/notion-task-discord').catch(() => null);
  assert.ok(module, 'private Discord task transport must exist');
  return module;
}
void test('task delivery verifies guild membership and a one-to-one DM before posting a native card', async () => {
  const { DiscordTaskClient } = await clientModule();
  const requests: { url: string; body: unknown }[] = [];
  const client = new DiscordTaskClient({
    guildId,
    botToken: 'test-token',
    fetch: (url, init) => {
      assert.ok(typeof url === 'string');
      const path = url;
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      requests.push({ url: path, body });
      if (path.includes('/guilds/'))
        return Promise.resolve(
          Response.json({ user: { id: userId, username: 'member' }, roles: [], pending: false }),
        );
      if (path.endsWith('/users/@me/channels'))
        return Promise.resolve(
          Response.json({ id: channelId, type: 1, recipients: [{ id: userId }] }),
        );
      return Promise.resolve(
        Response.json({ id: messageId, channel_id: channelId, nonce: body?.nonce }),
      );
    },
  });
  assert.equal(await client.membership(userId, guildId), true);
  const channel = await client.openDM(userId);
  assert.equal(
    (await client.sendCard(channel, userId, card, 'stable-operation')).messageId,
    messageId,
  );
  assert.deepEqual(requests[1]?.body, { recipient_id: userId });
  const sent = requests[2]?.body as Record<string, unknown>;
  assert.equal(sent.flags, 32768);
  assert.equal(sent.enforce_nonce, true);
  assert.equal(String(sent.nonce).length <= 25, true);
  assert.deepEqual(sent.allowed_mentions, { parse: [] });
  assert.equal('content' in sent, false);
});
void test('shared channels, incorrect recipients and unverified channel IDs never receive task content', async () => {
  const { DiscordTaskClient } = await clientModule();
  for (const reply of [
    { id: channelId, type: 0, recipients: [{ id: userId }] },
    { id: channelId, type: 1, recipients: [{ id: '999999999999999999' }] },
    { id: channelId, type: 3, recipients: [{ id: userId }, { id: '999999999999999999' }] },
  ]) {
    let calls = 0;
    const client = new DiscordTaskClient({
      guildId,
      botToken: 'token',
      fetch: () => {
        calls++;
        return Promise.resolve(Response.json(reply));
      },
    });
    await assert.rejects(client.openDM(userId));
    await assert.rejects(client.sendCard(channelId, userId, card, 'operation'));
    assert.equal(calls, 1);
  }
});
void test('rate limits persist a pause and block subsequent calls without a public-channel fallback', async () => {
  const { DiscordTaskClient } = await clientModule();
  let calls = 0,
    pause: { retryAfterMs: number; global: boolean } | null = null;
  const client = new DiscordTaskClient({
    guildId,
    botToken: 'token',
    rateLimit: {
      current: () => Promise.resolve(pause),
      defer: (input) => {
        pause = input;
        return Promise.resolve();
      },
    },
    fetch: () => {
      calls++;
      return Promise.resolve(Response.json({ retry_after: 120, global: true }, { status: 429 }));
    },
  });
  await assert.rejects(
    client.openDM(userId),
    (error) => error instanceof DiscordApiFailure && error.kind === 'rate_limited',
  );
  await assert.rejects(client.openDM(userId));
  assert.equal(calls, 1);
  assert.deepEqual(pause, { retryAfterMs: 120000, global: true });
});
void test('an edit preserves Components V2 and explicitly suppresses mentions', async () => {
  const { DiscordTaskClient } = await clientModule();
  const methods: string[] = [];
  const client = new DiscordTaskClient({
    guildId,
    botToken: 'token',
    fetch: (url, init) => {
      methods.push(init?.method ?? 'GET');
      if (typeof url === 'string' && url.endsWith('/users/@me/channels'))
        return Promise.resolve(
          Response.json({ id: channelId, type: 1, recipients: [{ id: userId }] }),
        );
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >;
      assert.deepEqual(body.allowed_mentions, { parse: [] });
      return Promise.resolve(Response.json({ id: messageId, channel_id: channelId }));
    },
  });
  const channel = await client.openDM(userId);
  await client.updateCard(channel, userId, messageId, card);
  assert.deepEqual(methods, ['POST', 'PATCH']);
});
