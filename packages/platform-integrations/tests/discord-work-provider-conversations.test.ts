import assert from 'node:assert/strict';
import test from 'node:test';
import { workScope } from './support/discord-work';
const forumId = '333333333333333333',
  botId = '444444444444444444';

void test('pinning uses the current Discord route and remains disabled without write access', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const requests: string[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    if (init?.method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(Response.json({ id: forumId, guild_id: workScope.guildId, type: 11 }));
  };
  const config = {
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: fetcher,
  };
  const messageId = '555555555555555555';
  await assert.rejects(
    new DiscordWorkClient(config).pinWorkMessage(forumId, messageId),
    /disabled/,
  );
  assert.equal(requests.length, 0);
  await new DiscordWorkClient({ ...config, allowWrites: true }).pinWorkMessage(forumId, messageId);
  assert.equal(
    requests[1],
    `PUT https://discord.com/api/v10/channels/${forumId}/messages/pins/${messageId}`,
  );
});
void test('work provider validates forum placement and required tags, and disables writes by default', async () => {
  const module = await import('../src/discord-work-provider').catch(() => null);
  assert.ok(module, 'guild work adapter exists');
  const writes: unknown[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (init?.method === 'POST') {
      writes.push(JSON.parse(typeof init.body === 'string' ? init.body : '') as unknown);
      return Promise.resolve(
        Response.json(
          {
            id: '555555555555555555',
            guild_id: workScope.guildId,
            parent_id: forumId,
            type: 11,
            message: { id: '555555555555555555', channel_id: '555555555555555555' },
          },
          { status: 201 },
        ),
      );
    }
    if (url.endsWith('/users/@me')) return Promise.resolve(Response.json({ id: botId }));
    if (url.endsWith('/roles'))
      return Promise.resolve(
        Response.json([
          {
            id: workScope.guildId,
            permissions: String((1n << 10n) | (1n << 11n) | (1n << 16n) | (1n << 38n)),
          },
        ]),
      );
    if (url.includes('/members/'))
      return Promise.resolve(Response.json({ user: { id: botId }, roles: [], pending: false }));
    return Promise.resolve(
      Response.json({
        id: forumId,
        guild_id: workScope.guildId,
        type: 15,
        parent_id: null,
        permission_overwrites: [],
        flags: 16,
        available_tags: [{ id: '666666666666666666', name: 'Task' }],
      }),
    );
  };
  const config = {
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: fetcher,
  };
  const client = new module.DiscordWorkClient(config);
  const inspection = await client.inspectDestination(forumId);
  assert.equal(inspection.destination.kind, 'forum');
  assert.equal(inspection.requiredTag, true);
  assert.equal(inspection.canCreateThreads, false);
  assert.equal(inspection.canSend, true);
  const request = {
    destination: inspection,
    title: 'Agenda',
    card: {
      flags: 32768,
      components: [{ type: 10, content: 'View task' }],
      allowed_mentions: { parse: [] as never[] },
    },
    operationId: 'create-one',
    tagIds: ['666666666666666666'],
  };
  await assert.rejects(client.createTaskConversation(request), /disabled/);
  assert.equal(writes.length, 0);
  const active = new module.DiscordWorkClient({ ...config, allowWrites: true });
  await assert.rejects(active.createTaskConversation({ ...request, tagIds: [] }), /tag/);
  const created = await active.createTaskConversation(request);
  assert.equal(created.threadId, '555555555555555555');
  assert.equal(writes.length, 1);
  await assert.rejects(
    active.createTaskConversation({ ...request, destination: { ...inspection, canSend: false } }),
    /permission/,
  );
  assert.equal(writes.length, 1, 'missing Send Messages must not create a forum post');
  assert.deepEqual(
    (writes[0] as { message: { allowed_mentions: unknown } }).message.allowed_mentions,
    { parse: [] },
  );
});

void test('destination inspection distinguishes public and private threads', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const threadId = '555555555555555555';
  let type = 11;
  const fetcher: typeof fetch = (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith('/users/@me')) return Promise.resolve(Response.json({ id: botId }));
    if (url.endsWith('/roles'))
      return Promise.resolve(
        Response.json([
          { id: workScope.guildId, permissions: String((1n << 10n) | (1n << 16n) | (1n << 38n)) },
        ]),
      );
    if (url.includes('/members/')) return Promise.resolve(Response.json({ roles: [] }));
    if (url.endsWith(threadId))
      return Promise.resolve(
        Response.json({
          id: threadId,
          guild_id: workScope.guildId,
          type,
          parent_id: forumId,
          thread_metadata: {},
        }),
      );
    return Promise.resolve(
      Response.json({
        id: forumId,
        guild_id: workScope.guildId,
        type: 0,
        permission_overwrites: [],
      }),
    );
  };
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: fetcher,
  });
  assert.equal((await client.inspectDestination(threadId)).privateThread, false);
  type = 12;
  assert.equal((await client.inspectDestination(threadId)).privateThread, true);
});

void test('forum recovery refuses two bot posts with the same operation marker', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const threads = ['555555555555555555', '666666666666666666'];
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: (input) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      if (path.endsWith('/users/@me')) return Promise.resolve(Response.json({ id: botId }));
      if (path.endsWith(`/channels/${forumId}`))
        return Promise.resolve(
          Response.json({ id: forumId, guild_id: workScope.guildId, type: 15 }),
        );
      if (path.endsWith('/threads/active'))
        return Promise.resolve(
          Response.json({
            threads: threads.map((id) => ({ id, guild_id: workScope.guildId, parent_id: forumId })),
          }),
        );
      if (path.endsWith('/threads/archived/public'))
        return Promise.resolve(Response.json({ threads: [], has_more: false }));
      const id = path.split('/').at(-1);
      return Promise.resolve(
        Response.json({
          id,
          channel_id: id,
          author: { id: botId },
          components: [{ url: 'https://www.notion.so/example?lvbt_work_create=operation' }],
        }),
      );
    },
  });
  assert.equal(
    await client.discoverWork({
      destinationId: forumId,
      operationId: 'operation',
      createForum: false,
      isTask: true,
    }),
    null,
  );
});

void test('forum recovery does not claim uniqueness when its bounded scan is incomplete', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const threads = Array.from({ length: 9 }, (_, i) => String(555555555555555550n + BigInt(i)));
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: (input) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      if (path.endsWith('/users/@me')) return Promise.resolve(Response.json({ id: botId }));
      if (path.endsWith(`/channels/${forumId}`))
        return Promise.resolve(
          Response.json({ id: forumId, guild_id: workScope.guildId, type: 15 }),
        );
      if (path.endsWith('/threads/active'))
        return Promise.resolve(
          Response.json({
            threads: threads.map((id) => ({ id, guild_id: workScope.guildId, parent_id: forumId })),
          }),
        );
      if (path.endsWith('/threads/archived/public'))
        return Promise.resolve(Response.json({ threads: [], has_more: false }));
      const id = path.split('/').at(-1);
      return Promise.resolve(
        Response.json({
          id,
          channel_id: id,
          author: { id: botId },
          components:
            id === threads[0]
              ? [{ url: 'https://www.notion.so/example?lvbt_work_create=operation' }]
              : [],
        }),
      );
    },
  });
  assert.equal(
    await client.discoverWork({
      destinationId: forumId,
      operationId: 'operation',
      createForum: false,
      isTask: true,
    }),
    null,
  );
});

void test('forum recovery finds an archived bot post only after a complete unambiguous scan', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const threadId = '555555555555555555';
  let more = false;
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: (input) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      if (path.endsWith('/users/@me')) return Promise.resolve(Response.json({ id: botId }));
      if (path.endsWith(`/channels/${forumId}`))
        return Promise.resolve(
          Response.json({ id: forumId, guild_id: workScope.guildId, type: 15 }),
        );
      if (path.endsWith('/threads/active')) return Promise.resolve(Response.json({ threads: [] }));
      if (path.endsWith('/threads/archived/public'))
        return Promise.resolve(
          Response.json({
            threads: [{ id: threadId, parent_id: forumId, guild_id: workScope.guildId }],
            has_more: more,
          }),
        );
      return Promise.resolve(
        Response.json({
          id: threadId,
          channel_id: threadId,
          author: { id: botId },
          components: [{ url: 'https://www.notion.so/example?lvbt_work_create=operation' }],
        }),
      );
    },
  });
  const input = {
    destinationId: forumId,
    operationId: 'operation',
    createForum: false,
    isTask: true,
  };
  assert.equal((await client.discoverWork(input))?.threadId, threadId);
  more = true;
  assert.equal(await client.discoverWork(input), null);
});

void test('existing event lookup requires one exact Notion link in a complete forum scan', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const pageId = '20000000-0000-4000-8000-000000000002';
  const ids = ['555555555555555555', '666666666666666666'];
  let duplicate = false;
  let more = false;
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: (input) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      if (path.endsWith(`/channels/${forumId}`))
        return Promise.resolve(
          Response.json({ id: forumId, guild_id: workScope.guildId, type: 15 }),
        );
      if (path.endsWith('/threads/active'))
        return Promise.resolve(
          Response.json({
            threads: [
              { id: ids[0], name: 'Park cleanup', parent_id: forumId, guild_id: workScope.guildId },
            ],
          }),
        );
      if (path.endsWith('/threads/archived/public'))
        return Promise.resolve(
          Response.json({
            threads: [
              {
                id: ids[1],
                name: 'Community meeting',
                parent_id: forumId,
                guild_id: workScope.guildId,
              },
            ],
            has_more: more,
          }),
        );
      const id = path.split('/').at(-1);
      const content =
        id === ids[0] || duplicate
          ? `Plan: https://app.notion.com/p/${pageId.replaceAll('-', '')}`
          : 'No link';
      return Promise.resolve(Response.json({ id, channel_id: id, content }));
    },
  });
  assert.equal(await client.findLinkedEvent(forumId, pageId), ids[0]);
  duplicate = true;
  assert.equal(await client.findLinkedEvent(forumId, pageId), null);
  duplicate = false;
  more = true;
  assert.equal(await client.findLinkedEvent(forumId, pageId), null);
});
