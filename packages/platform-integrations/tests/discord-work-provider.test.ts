import assert from 'node:assert/strict';
import test from 'node:test';
import { workScope } from './support/discord-work';
const forumId = '333333333333333333',
  botId = '444444444444444444';
function requestBody(init: RequestInit): unknown {
  assert.ok(typeof init.body === 'string');
  return JSON.parse(init.body) as unknown;
}

void test('forum tag updates preserve unrelated fields and refuse changed thread tags', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const threadId = '555555555555555555',
    humanTag = '777777777777777777',
    managedTag = '888888888888888888';
  let tags = [humanTag],
    writes = 0;
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    allowWrites: true,
    fetch: (_input, init) => {
      if (init?.method === 'PATCH') {
        const body = requestBody(init) as { applied_tags: string[] };
        assert.deepEqual(Object.keys(body), ['applied_tags']);
        tags = body.applied_tags;
        writes++;
      }
      return Promise.resolve(
        Response.json({
          id: threadId,
          guild_id: workScope.guildId,
          type: 11,
          parent_id: forumId,
          applied_tags: tags,
          thread_metadata: { archived: false, locked: false },
        }),
      );
    },
  });
  await client.updateForumTags({
    forumId,
    threadId,
    expectedTags: [humanTag],
    tags: [humanTag, managedTag],
  });
  assert.equal(writes, 1);
  tags = [];
  await assert.rejects(
    client.updateForumTags({
      forumId,
      threadId,
      expectedTags: [humanTag, managedTag],
      tags: [humanTag],
    }),
    /forum_tags_changed/,
  );
  assert.equal(writes, 1);
});
void test('forum topic changes require the expected topic and preserve an organizer edit', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  let topic: string | null = 'Original topic';
  let writes = 0;
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    allowWrites: true,
    fetch: (_input, init) => {
      if (init?.method === 'PATCH') {
        writes++;
        topic = (requestBody(init) as { topic: string }).topic;
      }
      return Promise.resolve(
        Response.json({ id: forumId, guild_id: workScope.guildId, type: 15, topic }),
      );
    },
  });
  await client.updateForumTopic({
    forumId,
    expectedTopic: 'Original topic',
    topic: 'Project plan: https://www.notion.so/example',
  });
  assert.equal(writes, 1);
  topic = 'Organizer edited this';
  await assert.rejects(
    client.updateForumTopic({ forumId, expectedTopic: 'Original topic', topic: 'Replacement' }),
    /forum_topic_changed/,
  );
  assert.equal(writes, 1);
  assert.equal(topic, 'Organizer edited this');
});
void test('project forum creation rejects a response in a different category', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (init?.method === 'POST')
      return Promise.resolve(
        Response.json(
          {
            id: '555555555555555555',
            guild_id: workScope.guildId,
            type: 15,
            parent_id: '666666666666666666',
          },
          { status: 201 },
        ),
      );
    if (url.endsWith(`/guilds/${workScope.guildId}`))
      return Promise.resolve(Response.json({ features: ['COMMUNITY'] }));
    return Promise.resolve(Response.json({ id: forumId, guild_id: workScope.guildId, type: 4 }));
  };
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: fetcher,
    allowWrites: true,
  });
  await assert.rejects(
    client.createProjectForum({
      categoryId: forumId,
      name: 'Project',
      projectUrl: 'https://www.notion.so/project',
      operationId: 'operation',
    }),
  );
});
void test('category recovery requires one matching bot audit entry and a current category', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const entry = {
    action_type: 10,
    user_id: botId,
    reason: 'LVBT route setup request',
    target_id: forumId,
  };
  let entries: unknown[] = [],
    type = 4;
  const fetcher: typeof fetch = (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith('/users/@me')) return Promise.resolve(Response.json({ id: botId }));
    if (url.includes('/audit-logs?'))
      return Promise.resolve(Response.json({ audit_log_entries: entries }));
    return Promise.resolve(
      Response.json({ id: forumId, guild_id: workScope.guildId, type, parent_id: null }),
    );
  };
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: fetcher,
  });
  assert.equal(await client.findCreatedCategory('request'), null);
  entries = [entry, { ...entry, user_id: '777777777777777777' }];
  assert.equal(await client.findCreatedCategory('request'), forumId);
  entries = [entry, entry];
  assert.equal(await client.findCreatedCategory('request'), null);
  entries = [entry];
  type = 0;
  assert.equal(await client.findCreatedCategory('request'), null);
});
void test('forum overview pin preserves existing thread flags and verifies its parent', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const threadId = '555555555555555555';
  let flags = 8,
    writes = 0,
    parentId = forumId;
  let active: unknown[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith('/threads/active')) return Promise.resolve(Response.json({ threads: active }));
    if (init?.method === 'PATCH') {
      writes++;
      flags = (requestBody(init) as { flags: number }).flags;
      return Promise.resolve(
        Response.json({ id: threadId, guild_id: workScope.guildId, parent_id: parentId, flags }),
      );
    }
    return Promise.resolve(
      Response.json(
        url.endsWith(forumId)
          ? { id: forumId, guild_id: workScope.guildId, type: 15 }
          : {
              id: threadId,
              guild_id: workScope.guildId,
              parent_id: parentId,
              type: 11,
              flags,
              thread_metadata: { archived: false },
            },
      ),
    );
  };
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: fetcher,
    allowWrites: true,
  });
  await client.pinForumPost(forumId, threadId);
  assert.equal(flags, 10);
  await client.pinForumPost(forumId, threadId);
  assert.equal(writes, 1);
  parentId = '666666666666666666';
  await assert.rejects(client.pinForumPost(forumId, threadId));
  assert.equal(writes, 1);
  parentId = forumId;
  flags = 8;
  active = [{ id: '666666666666666666', parent_id: forumId, flags: 2 }];
  await assert.rejects(client.pinForumPost(forumId, threadId), /forum_already_has_pinned_post/);
  assert.equal(writes, 1);
});
void test('category preview checks server-wide bot permissions and audience changes', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  let permissions = '16';
  const fetcher: typeof fetch = (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith('/users/@me')) return Promise.resolve(Response.json({ id: botId }));
    if (url.endsWith('/roles'))
      return Promise.resolve(Response.json([{ id: workScope.guildId, permissions }]));
    return Promise.resolve(Response.json({ roles: [] }));
  };
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: fetcher,
  });
  const first = await client.inspectGuildPlacement();
  assert.equal(first.canManageChannels, true);
  permissions = '0';
  const changed = await client.inspectGuildPlacement();
  assert.equal(changed.canManageChannels, false);
  assert.notEqual(changed.audienceFingerprint, first.audienceFingerprint);
});
void test('destination recovery requires one exact channel marker in the approved category', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const channel = {
    id: '555555555555555555',
    guild_id: workScope.guildId,
    parent_id: forumId,
    type: 15,
    topic: 'LVBT route setup: operation',
  };
  let rows: unknown[] = [];
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: () => Promise.resolve(Response.json(rows)),
  });
  const input = { kind: 'forum' as const, parentId: forumId, operationId: 'operation' };
  assert.equal(await client.findRouteDestination(input), null);
  rows = [channel, { ...channel, id: '666666666666666666', parent_id: '777777777777777777' }];
  assert.equal(await client.findRouteDestination(input), channel.id);
  rows = [channel, { ...channel, id: '666666666666666666' }];
  assert.equal(await client.findRouteDestination(input), null);
});
void test('route destination creation validates category, community support and returned channel', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const createdId = '555555555555555555';
  const writes: Record<string, unknown>[] = [];
  let community = true;
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (init?.method === 'POST') {
      const body = requestBody(init) as Record<string, unknown>;
      writes.push(body);
      return Promise.resolve(
        Response.json(
          {
            id: createdId,
            guild_id: workScope.guildId,
            type: body.type,
            parent_id: body.parent_id ?? null,
          },
          { status: 201 },
        ),
      );
    }
    if (url.endsWith(`/guilds/${workScope.guildId}`))
      return Promise.resolve(
        Response.json({ id: workScope.guildId, features: community ? ['COMMUNITY'] : [] }),
      );
    return Promise.resolve(Response.json({ id: forumId, guild_id: workScope.guildId, type: 4 }));
  };
  const config = {
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    fetch: fetcher,
  };
  const input = {
    kind: 'forum' as const,
    name: 'Events',
    parentId: forumId,
    operationId: 'route-setup-1',
  };
  await assert.rejects(new DiscordWorkClient(config).createRouteDestination(input), /disabled/);
  const client = new DiscordWorkClient({ ...config, allowWrites: true });
  community = false;
  await assert.rejects(client.createRouteDestination(input), /forum_unavailable/);
  assert.equal(writes.length, 0);
  community = true;
  assert.deepEqual(await client.createRouteDestination(input), {
    channelId: createdId,
    parentId: forumId,
  });
  assert.deepEqual(writes[0], {
    name: 'Events',
    type: 15,
    parent_id: forumId,
    topic: 'LVBT route setup: route-setup-1',
  });
  await client.createRouteDestination({
    kind: 'category',
    name: 'Projects',
    operationId: 'route-setup-2',
  });
  assert.deepEqual(writes[1], { name: 'Projects', type: 4 });
  await client.createRouteDestination({
    kind: 'text',
    name: 'events',
    parentId: forumId,
    operationId: 'route-setup-3',
  });
  assert.deepEqual(writes[2], {
    name: 'events',
    type: 0,
    parent_id: forumId,
    topic: 'LVBT route setup: route-setup-3',
  });
});
