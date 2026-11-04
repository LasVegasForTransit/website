import assert from 'node:assert/strict';
import test from 'node:test';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import {
  enqueueWorkOperation,
  queueFooterReconciliation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { readWorkConversation } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { seedActiveWorkRoute } from '@lasvegasfortransit/platform-storage/test-db';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { discordRateLimit } from '../src/discord-rate-limit';
import { workAudience } from '../src/discord-work-permissions';
import { resolveWorkActor } from '../src/discord-work-authority';
import { runDiscordWorkBatch } from '../src/discord-work-runner';
import {
  discordUserId,
  projectId,
  projectSourceId,
  sourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('project creation queues its Notion link within the metered jobs budget', async () => {
  const { db, notion, project } = workFixture();
  const categoryId = '333333333333333333',
    botId = '444444444444444444',
    forumId = '555555555555555555',
    threadId = '666666666666666666';
  const roles = [{ id: workScope.guildId, permissions: '8' }];
  const channel = (id: string, type: number, parent: string | null) => ({
    id,
    guild_id: workScope.guildId,
    type,
    parent_id: parent,
    permission_overwrites: [],
    name: 'Project',
    flags: 0,
    thread_metadata: { archived: false, locked: false },
  });
  let posts = 0;
  const guildResponse = (path: string): Response | null => {
    if (path.endsWith('/users/@me')) return Response.json({ id: botId });
    if (path.endsWith('/roles')) return Response.json(roles);
    if (path.includes('/members/'))
      return Response.json({
        user: { id: path.split('/').at(-1), username: 'member' },
        roles: [],
        pending: false,
      });
    if (path.endsWith('/threads/active')) return Response.json({ threads: [] });
    return null;
  };
  const existingChannel = (path: string, init: RequestInit | undefined): Response | null => {
    if (path.endsWith(categoryId)) return Response.json(channel(categoryId, 4, null));
    if (path.endsWith(forumId)) return Response.json(channel(forumId, 15, categoryId));
    if (path.endsWith(threadId))
      return Response.json({
        ...channel(threadId, 11, forumId),
        flags: init?.method === 'PATCH' ? 2 : 0,
      });
    return null;
  };
  const fetcher: typeof fetch = (input, init) => {
    const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
    const shared = guildResponse(path);
    if (shared) return Promise.resolve(shared);
    if (path.endsWith(`/guilds/${workScope.guildId}/channels`) && init?.method === 'POST')
      return Promise.resolve(Response.json(channel(forumId, 15, categoryId), { status: 201 }));
    if (path.endsWith(`/guilds/${workScope.guildId}`))
      return Promise.resolve(Response.json({ id: workScope.guildId, features: ['COMMUNITY'] }));
    if (path.endsWith(`/channels/${forumId}/threads`) && init?.method === 'POST') {
      posts++;
      return Promise.resolve(
        Response.json(
          { ...channel(threadId, 11, forumId), message: { id: threadId } },
          { status: 201 },
        ),
      );
    }
    if (path.includes('/messages/pins/') && init?.method === 'PUT')
      return Promise.resolve(new Response(null, { status: 204 }));
    const existing = existingChannel(path, init);
    if (existing) return Promise.resolve(existing);
    throw new Error(`Unexpected Discord path ${path}`);
  };
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    const actor = await resolveWorkActor(db, workScope, discordUserId);
    assert.ok(actor);
    const fingerprint = await workAudience(roles, [], categoryId);
    Object.assign(project.properties, { Status: { type: 'status', status: { name: 'Planning' } } });
    seedActiveWorkRoute(
      db,
      {
        id: 'route',
        scope: workScope,
        sourceId: projectSourceId,
        kind: 'project',
        state: 'active',
        revision: 1,
        trigger: { property: 'Status', values: ['Planning'] },
        destination: { kind: 'category', channelId: categoryId },
        approvedBy: actor.personId,
        approvedDiscordId: discordUserId,
        approvedGrantVersion: actor.grantVersion,
        audienceFingerprint: fingerprint,
      },
      workNow,
    );
    await enqueueWorkOperation(
      db,
      {
        id: 'provision',
        scope: workScope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'provision',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: {
          intent: 'home',
          linkId: 'home',
          subject: { kind: 'project_plan', sourceId: projectSourceId, pageId: projectId },
          title: 'Project',
          destinationId: categoryId,
          audienceFingerprint: fingerprint,
          createForum: true,
          routeId: 'route',
          routeRevision: 1,
          tagIds: [],
        },
      },
      workNow,
    );
    const budget = queryBudget(db, 49);
    const discord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: botId,
      botToken: 'fixture',
      allowWrites: true,
      fetch: fetcher,
      rateLimit: discordRateLimit(budget.db, botId, () => workNow),
    });
    const result = await runDiscordWorkBatch(
      budget.db,
      { notion, discord },
      {
        scope: workScope,
        taskSourceId: sourceId,
        enabled: true,
        clock: () => workNow,
        stage: 'effects',
        deadline: Date.now() + 60_000,
        maxLinks: 1,
        maxEffects: 1,
      },
    );
    assert.equal(
      result.kind,
      'progress',
      `creation used ${budget.queries} queries: ${result.reason}`,
    );
    assert.equal(posts, 1);
    assert.ok(
      db.raw
        .prepare("SELECT 1 FROM discord_work_operations WHERE kind='backlink' AND state='queued'")
        .get(),
    );
    db.raw
      .prepare("UPDATE discord_work_operations SET next_attempt_at=? WHERE kind='backlink'")
      .run(new Date(workNow.getTime() + 60_000).toISOString());
    const pinBudget = queryBudget(db, 49);
    const pinDiscord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: botId,
      botToken: 'fixture',
      allowWrites: true,
      fetch: fetcher,
      rateLimit: discordRateLimit(pinBudget.db, botId, () => workNow),
    });
    const pins = await runDiscordWorkBatch(
      pinBudget.db,
      { notion, discord: pinDiscord },
      {
        scope: workScope,
        taskSourceId: sourceId,
        enabled: true,
        clock: () => workNow,
        stage: 'effects',
        deadline: Date.now() + 60_000,
        maxLinks: 1,
        maxEffects: 1,
      },
    );
    assert.equal(pins.kind, 'progress');
    const pinned = db.raw
      .prepare(
        "SELECT json_extract(data_json,'$.overviewPin') AS message_pin, json_extract(data_json,'$.overviewPostPin') AS post_pin FROM discord_project_homes WHERE id='home'",
      )
      .get();
    assert.ok(pinned);
    assert.equal(pinned.message_pin, 'pinned');
    assert.equal(pinned.post_pin, 'pinned');
    db.raw
      .prepare("UPDATE discord_work_operations SET next_attempt_at=? WHERE kind='backlink'")
      .run(workNow.toISOString());
    const blocks: Record<string, unknown>[] = [];
    Object.assign(notion, {
      readSelf: () => Promise.resolve({ id: 'bot', type: 'bot' }),
      listBlockChildren: () => Promise.resolve({ results: blocks, nextCursor: null }),
      readBlock: (id: string) => Promise.resolve(blocks.find((block) => block.id === id)),
      appendBlockChildren: (_pageId: string, children: Record<string, unknown>[]) => {
        const created = children.map((block, i) => ({
          ...block,
          id: `block-${blocks.length + i}`,
          created_by: { id: 'bot' },
        }));
        blocks.push(...created);
        return Promise.resolve({ results: created });
      },
      updateBlock: (id: string) => {
        const index = blocks.findIndex((block) => block.id === id);
        if (index >= 0) blocks.splice(index, 1);
        return Promise.resolve({ id, in_trash: true });
      },
    });
    const linkBudget = queryBudget(db, 49);
    const linkDiscord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: botId,
      botToken: 'fixture',
      allowWrites: true,
      fetch: fetcher,
      rateLimit: discordRateLimit(linkBudget.db, botId, () => workNow),
    });
    const link = await runDiscordWorkBatch(
      linkBudget.db,
      { notion, discord: linkDiscord },
      {
        scope: workScope,
        taskSourceId: sourceId,
        enabled: true,
        clock: () => workNow,
        stage: 'effects',
        deadline: Date.now() + 60_000,
        maxLinks: 1,
        maxEffects: 1,
      },
    );
    assert.equal(
      link.kind,
      'progress',
      `backlink consumed ${linkBudget.queries} queries: ${link.reason}`,
    );
    assert.deepEqual(
      blocks.map((block) => block.type),
      ['divider', 'paragraph'],
    );
    blocks.push({
      id: 'human',
      type: 'paragraph',
      created_by: { id: 'human' },
      paragraph: { rich_text: [] },
    });
    const c = await readWorkConversation(db, workScope, 'overview-home');
    assert.ok(c);
    const later = new Date(workNow.getTime() + 61_000);
    assert.equal(await queueFooterReconciliation(db, c, later), true);
    const repairBudget = queryBudget(db, 49);
    const repairDiscord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: botId,
      botToken: 'fixture',
      allowWrites: true,
      fetch: fetcher,
      rateLimit: discordRateLimit(repairBudget.db, botId, () => later),
    });
    const repair = await runDiscordWorkBatch(
      repairBudget.db,
      { notion, discord: repairDiscord },
      {
        scope: workScope,
        taskSourceId: sourceId,
        enabled: true,
        clock: () => later,
        stage: 'effects',
        deadline: Date.now() + 60_000,
        maxLinks: 1,
        maxEffects: 1,
      },
    );
    assert.equal(
      repair.kind,
      'progress',
      `repair consumed ${repairBudget.queries} queries: ${repair.reason}`,
    );
    assert.deepEqual(
      blocks.map((block) => block.type),
      ['paragraph', 'divider', 'paragraph'],
    );
  } finally {
    db.raw.close();
  }
});
