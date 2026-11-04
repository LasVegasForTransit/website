import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
void test('work interactions defer private provider reads, isolate the guild and keep tokens out of durable state', async () => {
  const module = await import('../src/discord-work-interactions').catch(() => null);
  assert.ok(module, 'native work interaction handler exists');
  const db = memoryDb(),
    pending: Promise<unknown>[] = [],
    sent: unknown[] = [];
  const intents: unknown[] = [];
  const context = {
    applicationId: '111111111111111111',
    guildId: '222222222222222222',
    enabled: false,
    preview: {
      preview: (input: { intent: unknown }) => {
        intents.push(input.intent);
        return Promise.resolve({
          kind: 'ready' as const,
          card: {
            flags: 32768,
            allowed_mentions: { parse: [] as never[] },
            components: [{ type: 10, content: 'Preview' }],
          },
        });
      },
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
    const creation = {
      ...interaction,
      data: {
        name: 'work',
        options: [
          {
            name: 'create-event-forum',
            options: [
              { name: 'name', value: 'Events' },
              { name: 'category', value: '777777777777777777' },
            ],
          },
        ],
      },
    };
    assert.ok(await module.handleWorkInteraction(db, creation, context));
    await Promise.all(pending);
    assert.deepEqual(intents.at(-1), {
      action: 'create-event-forum',
      url: undefined,
      destinationId: '777777777777777777',
      name: 'Events',
    });
    const showOne = {
      ...interaction,
      data: {
        name: 'work',
        options: [
          {
            name: 'show',
            options: [
              { name: 'url', value: 'https://www.notion.so/10000000000040008000000000000001' },
            ],
          },
        ],
      },
    };
    assert.ok(await module.handleWorkInteraction(db, showOne, context));
    await Promise.all(pending);
    assert.equal(
      (intents.at(-1) as { url: string }).url,
      'https://www.notion.so/10000000000040008000000000000001',
    );
    const tagSelect = {
      ...interaction,
      type: 3,
      data: {
        custom_id: 'work:receipt:1:route-tag',
        values: ['666666666666666666', '888888888888888888'],
      },
      message: { id: '999999999999999999' },
    };
    assert.ok(await module.handleWorkInteraction(db, tagSelect, context));
    await Promise.all(pending);
    assert.deepEqual((intents.at(-1) as { values: string[] }).values, [
      '666666666666666666',
      '888888888888888888',
    ]);
    const statusSelect = {
      ...tagSelect,
      data: { custom_id: 'work:receipt:1:route-choice', values: ['0', '1', '2'] },
    };
    assert.ok(await module.handleWorkInteraction(db, statusSelect, context));
    await Promise.all(pending);
    assert.deepEqual((intents.at(-1) as { values: string[] }).values, ['0', '1', '2']);
    const projectTagCommand = {
      ...interaction,
      data: {
        name: 'work',
        options: [
          {
            name: 'project-event-tags',
            options: [{ name: 'destination', value: '777777777777777777' }],
          },
        ],
      },
    };
    assert.ok(await module.handleWorkInteraction(db, projectTagCommand, context));
    await Promise.all(pending);
    assert.equal(
      (intents.at(-1) as { action: string; destinationId: string }).action,
      'project-event-tags',
    );
    assert.equal((intents.at(-1) as { destinationId: string }).destinationId, '777777777777777777');
    const topicCommand = {
      ...interaction,
      data: {
        name: 'work',
        options: [
          {
            name: 'project-topic',
            options: [{ name: 'destination', value: '777777777777777777' }],
          },
        ],
      },
    };
    const topicResponse = await module.handleWorkInteraction(db, topicCommand, context);
    assert.deepEqual(await topicResponse?.json(), { type: 5, data: { flags: 64 } });
    await Promise.all(pending);
    assert.deepEqual(intents.at(-1), {
      action: 'project-topic',
      url: undefined,
      destinationId: '777777777777777777',
      name: undefined,
    });
    const topicConfirm = {
      ...interaction,
      type: 3,
      data: { custom_id: 'work:receipt:1:topic-confirm' },
      message: { id: '999999999999999999' },
    };
    assert.ok(await module.handleWorkInteraction(db, topicConfirm, context));
    await Promise.all(pending);
    assert.equal((intents.at(-1) as { action: string }).action, 'topic-confirm');
    assert.equal((intents.at(-1) as { linkId: string }).linkId, 'receipt');
    const projectTagSelect = {
      ...tagSelect,
      data: {
        custom_id: 'work:receipt:1:project-tag-save',
        values: ['666666666666666666', '888888888888888888'],
      },
    };
    assert.ok(await module.handleWorkInteraction(db, projectTagSelect, context));
    await Promise.all(pending);
    assert.deepEqual((intents.at(-1) as { values: string[] }).values, [
      '666666666666666666',
      '888888888888888888',
    ]);
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
