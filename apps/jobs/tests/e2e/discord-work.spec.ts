import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { Response as RuntimeResponse } from 'miniflare';
import {
  saveProjectHome,
  saveWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { taskPolicy } from '@lasvegasfortransit/platform-integrations/test-task-policy';
import { taskRuntime } from './support/task-checkins';
const projectId = '10000000-0000-4000-8000-000000000088',
  forumId = '888888888888888888',
  botId = '111111111111111111';
const privateReplies: unknown[] = [],
  edits: unknown[] = [];
const json = (value: unknown) =>
  new RuntimeResponse(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const fixture = await taskRuntime({
  sharedWork: true,
  workResponse: async (request, url) => {
    if (url.pathname.includes('/webhooks/')) {
      privateReplies.push(await request.json());
      return json({ id: 'private' });
    }
    if (url.pathname === `/v1/pages/${projectId}`)
      return json({
        object: 'page',
        id: projectId,
        parent: { data_source_id: taskPolicy.projectsSourceId },
        properties: { Lead: { type: 'people', people: [] } },
      });
    if (url.pathname === '/api/v10/users/@me') return json({ id: botId });
    if (url.pathname === '/api/v10/oauth2/applications/@me')
      return json({ id: botId, flags: 1 << 19 });
    if (url.pathname.endsWith('/roles'))
      return json([
        {
          id: taskPolicy.guildId,
          permissions: String((1n << 10n) | (1n << 11n) | (1n << 16n) | (1n << 38n)),
        },
      ]);
    if (url.pathname.endsWith(`/members/${botId}`))
      return json({ user: { id: botId }, roles: [], pending: false });
    if (url.pathname === `/api/v10/channels/${forumId}`)
      return json({
        id: forumId,
        guild_id: taskPolicy.guildId,
        type: 15,
        permission_overwrites: [],
        available_tags: [],
      });
    if (url.pathname === '/api/v10/channels/444444444444444445')
      return json({
        id: '444444444444444445',
        guild_id: taskPolicy.guildId,
        type: 11,
        parent_id: forumId,
        thread_metadata: { archived: false, locked: false },
      });
    if (url.pathname === '/api/v10/channels/444444444444444445/messages')
      return json([
        {
          id: '555555555555555557',
          channel_id: '444444444444444445',
          author: { id: '333333333333333334', username: 'Guest' },
          type: 0,
          timestamp: new Date().toISOString(),
          content: 'Agenda is ready for review.',
        },
      ]);
    if (url.pathname === '/api/v10/channels/444444444444444445/messages/555555555555555556') {
      if (request.method === 'PATCH') edits.push(await request.json());
      return json({
        id: '555555555555555556',
        channel_id: '444444444444444445',
        author: { id: botId },
      });
    }
    return null;
  },
});
async function until(predicate: () => Promise<boolean>) {
  for (let i = 0; i < 40; i++) {
    if (await predicate()) return;
    await setTimeout(50);
  }
  assert.fail('deferred work did not settle');
}
try {
  const account = fixture.accounts[1];
  assert.ok(account);
  for (const page of fixture.pages) page.properties.Project.relation.push({ id: projectId });
  const scope = {
    environment: 'preview' as const,
    guildId: fixture.guildId,
    workspaceId: 'workspace',
  };
  // Use the provider's actual fingerprint so the compiled path checks approved audience.
  const { workAudience } =
    await import('../../../../packages/platform-integrations/src/discord-work-permissions');
  const permissions = String((1n << 10n) | (1n << 11n) | (1n << 16n) | (1n << 38n));
  const audience = await workAudience([{ id: scope.guildId, permissions }], [], forumId);
  await saveProjectHome(
    fixture.db,
    {
      id: 'home',
      scope,
      projectSourceId: taskPolicy.projectsSourceId,
      projectId,
      taskSourceId: fixture.sourceId,
      destination: { kind: 'forum', channelId: forumId, parentId: null },
      taskParent: null,
      audienceFingerprint: audience,
      approvedBy: 'staff',
      state: 'active',
      generation: 1,
      title: 'Committee work',
    },
    0,
    new Date(),
  );
  await saveWorkConversation(
    fixture.db,
    {
      id: 'conversation',
      scope,
      subject: { kind: 'task', sourceId: fixture.sourceId, pageId: account.task },
      homeId: 'home',
      placementProjectId: projectId,
      threadId: account.channel,
      starterMessageId: account.message,
      cardChannelId: account.channel,
      mode: 'automatic',
      state: 'active',
      generation: 1,
      activationId: account.message,
      cursorId: account.message,
      windowUpperId: null,
      windowBeforeId: null,
      footerBlockIds: [],
    },
    0,
    new Date(),
  );
  const show = await fixture.signed({
    type: 2,
    guild_id: scope.guildId,
    channel_id: account.channel,
    token: 'fixture-only',
    member: { user: { id: account.user } },
    data: { name: 'work', options: [{ name: 'show' }] },
  });
  assert.deepEqual(await show.json(), { type: 5, data: { flags: 64 } });
  await until(() => Promise.resolve(privateReplies.length === 1));
  assert.match(JSON.stringify(privateReplies), /Committee work/);
  assert.equal((await fixture.steps.workIngest.run()).kind, 'progress');
  assert.equal((await fixture.steps.workEffects.run()).kind, 'progress');
  assert.equal(fixture.comments.length, 1);
  assert.match(JSON.stringify(fixture.comments[0]), /Agenda is ready for review/);
  const status = await fixture.signed({
    type: 3,
    guild_id: scope.guildId,
    channel_id: account.channel,
    token: 'fixture-only',
    member: { user: { id: account.user } },
    message: { id: account.message },
    data: { custom_id: 'work:conversation:1:status', values: ['Done'] },
  });
  assert.equal(status.status, 200);
  await until(async () =>
    Boolean(
      await fixture.db
        .prepare("SELECT 1 FROM discord_work_operations WHERE kind='status' AND state='queued'")
        .first(),
    ),
  );
  assert.equal((await fixture.steps.workEffects.run()).kind, 'progress');
  assert.deepEqual(fixture.completions, [account.task]);
  assert.equal(edits.length, 1);
  assert.match(JSON.stringify(edits[0]), /Done/);
  assert.equal(fixture.sends.length, 0, 'shared updates never send private reminders');
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT count(*) AS n FROM task_checkin_operations WHERE kind='delivery'")
        .first<{ n: number }>()
    )?.n,
    0,
  );
  console.log(
    'Compiled signed Discord callback → private WorkPreview RPC → durable shared status → Notion → same card passed.',
  );
} finally {
  await fixture.dispose();
}
