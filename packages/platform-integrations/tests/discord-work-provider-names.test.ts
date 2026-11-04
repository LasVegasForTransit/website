import assert from 'node:assert/strict';
import test from 'node:test';
import { workScope } from './support/discord-work';
const forumId = '333333333333333333',
  botId = '444444444444444444';
function requestBody(init: RequestInit): unknown {
  assert.ok(typeof init.body === 'string');
  return JSON.parse(init.body) as unknown;
}

void test('planning name updates preserve organizer edits and never reopen archived posts', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const threadId = '555555555555555555';
  let name = 'Original',
    archived = false,
    writes = 0;
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    allowWrites: true,
    fetch: (_input, init) => {
      if (init?.method === 'PATCH') {
        const body = requestBody(init) as { name: string };
        assert.deepEqual(Object.keys(body), ['name']);
        name = body.name;
        writes++;
      }
      return Promise.resolve(
        Response.json({
          id: threadId,
          guild_id: workScope.guildId,
          type: 11,
          parent_id: forumId,
          name,
          thread_metadata: { archived, locked: false },
        }),
      );
    },
  });
  const input = {
    channelId: threadId,
    parentId: forumId,
    kind: 'thread' as const,
    expectedName: 'Original',
    name: 'Updated',
  };
  await client.updatePlanningName(input);
  assert.equal(name, 'Updated');
  name = 'Organizer title';
  await assert.rejects(client.updatePlanningName(input), /planning_name_changed/);
  assert.equal(writes, 1);
  name = 'Original';
  archived = true;
  await assert.rejects(client.updatePlanningName(input), /planning_post_archived/);
  assert.equal(writes, 1);
  archived = false;
  await assert.rejects(
    client.updatePlanningName({
      ...input,
      beforeWrite: () => Promise.reject(new Error('lease_changed')),
    }),
    /lease_changed/,
  );
  assert.equal(writes, 1);
});

void test('the name-update lease is checked after the shared rate-limit lookup', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const threadId = '555555555555555555';
  let lookups = 0,
    active = true,
    writes = 0;
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture-only',
    allowWrites: true,
    rateLimit: {
      current: () => {
        if (++lookups === 2) active = false;
        return Promise.resolve(null);
      },
      defer: () => Promise.resolve(),
    },
    fetch: (_input, init) => {
      if (init?.method === 'PATCH') writes++;
      return Promise.resolve(
        Response.json({
          id: threadId,
          guild_id: workScope.guildId,
          type: 11,
          parent_id: forumId,
          name: 'Original',
          thread_metadata: { archived: false, locked: false },
        }),
      );
    },
  });
  await assert.rejects(
    client.updatePlanningName({
      channelId: threadId,
      parentId: forumId,
      kind: 'thread',
      expectedName: 'Original',
      name: 'Updated',
      beforeWrite: () => (active ? Promise.resolve() : Promise.reject(new Error('lease_changed'))),
    }),
    /lease_changed/,
  );
  assert.equal(writes, 0);
});

void test('a timed-out pre-dispatch check never sends a Discord rename', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const threadId = '555555555555555555';
  let writes = 0;
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture',
    allowWrites: true,
    timeoutMs: 50,
    preflightTimeoutMs: 10,
    fetch: (_input, init) => {
      if (init?.method === 'PATCH') writes++;
      return Promise.resolve(
        Response.json({
          id: threadId,
          guild_id: workScope.guildId,
          type: 11,
          parent_id: forumId,
          name: 'Original',
          thread_metadata: { archived: false, locked: false },
        }),
      );
    },
  });
  await assert.rejects(
    client.updatePlanningName({
      channelId: threadId,
      parentId: forumId,
      kind: 'thread',
      expectedName: 'Original',
      name: 'Updated',
      beforeWrite: () => new Promise((resolve) => setTimeout(resolve, 40)),
    }),
    /dispatch_timeout/,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(writes, 0);
});

void test('a healthy slow preflight gets its own time budget before the Discord request', async () => {
  const { DiscordWorkClient } = await import('../src/discord-work-provider');
  const threadId = '555555555555555555';
  let writes = 0;
  const client = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: botId,
    botToken: 'fixture',
    allowWrites: true,
    timeoutMs: 50,
    preflightTimeoutMs: 150,
    fetch: (_input, init) => {
      const patch = init?.method === 'PATCH';
      if (patch) writes++;
      return Promise.resolve(
        Response.json({
          id: threadId,
          guild_id: workScope.guildId,
          type: 11,
          parent_id: forumId,
          name: patch ? 'Updated' : 'Original',
          thread_metadata: { archived: false, locked: false },
        }),
      );
    },
  });
  await client.updatePlanningName({
    channelId: threadId,
    parentId: forumId,
    kind: 'thread',
    expectedName: 'Original',
    name: 'Updated',
    beforeWrite: () => new Promise((resolve) => setTimeout(resolve, 80)),
  });
  assert.equal(writes, 1);
});
