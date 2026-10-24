import assert from 'node:assert/strict';
import test from 'node:test';
import { workScope } from './support/discord-work';
const forumId = '333333333333333333',
  botId = '444444444444444444';
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
            permissions: String(
              (1n << 10n) | (1n << 11n) | (1n << 16n) | (1n << 35n) | (1n << 38n),
            ),
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
  assert.deepEqual(
    (writes[0] as { message: { allowed_mentions: unknown } }).message.allowed_mentions,
    { parse: [] },
  );
});
