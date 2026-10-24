import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
void test('work interactions defer private provider reads, isolate the guild and keep tokens out of durable state', async () => {
  const module = await import('../src/discord-work-interactions').catch(() => null);
  assert.ok(module, 'native work interaction handler exists');
  const db = memoryDb(),
    pending: Promise<unknown>[] = [],
    sent: unknown[] = [];
  const context = {
    applicationId: '111111111111111111',
    guildId: '222222222222222222',
    enabled: false,
    preview: {
      preview: () =>
        Promise.resolve({
          kind: 'ready' as const,
          card: {
            flags: 32768,
            allowed_mentions: { parse: [] as never[] },
            components: [{ type: 10, content: 'Preview' }],
          },
        }),
    },
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    fetcher: (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(typeof init?.body === 'string' ? init.body : '') as unknown);
      return Promise.resolve(Response.json({ id: 'message' }));
    },
  };
  const interaction = {
    id: '333333333333333333',
    application_id: context.applicationId,
    guild_id: context.guildId,
    channel_id: '444444444444444444',
    type: 2,
    token: 'fixture-token-not-a-real-token',
    member: { user: { id: '555555555555555555' } },
    data: {
      name: 'work',
      options: [
        {
          name: 'link',
          options: [
            { name: 'url', value: 'https://www.notion.so/10000000000040008000000000000001' },
          ],
        },
      ],
    },
  };
  try {
    const response = await module.handleWorkInteraction(db, interaction, context);
    assert.ok(response);
    assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } });
    await Promise.all(pending);
    assert.equal(sent.length, 1);
    assert.equal(
      (
        await module.handleWorkInteraction(
          db,
          { ...interaction, guild_id: '666666666666666666' },
          context,
        )
      )?.status,
      403,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_operations').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
