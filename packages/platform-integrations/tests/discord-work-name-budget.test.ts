import assert from 'node:assert/strict';
import test from 'node:test';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import {
  saveProjectHome,
  saveWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { enqueueWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { discordRateLimit } from '../src/discord-rate-limit';
import { workAudience } from '../src/discord-work-permissions';
import { resolveWorkActor } from '../src/discord-work-authority';
import { runDiscordWorkBatch } from '../src/discord-work-runner';
import { runWorkPreview } from '../src/discord-work-setup';
import { NotionTaskApiError } from '../src/notion-task-client';
import {
  discordUserId,
  projectId,
  projectSourceId,
  sourceId,
  taskId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('scheduled name sync and organizer status fit the real 50-query job budget', async () => {
  const { db, notion, project } = workFixture();
  const forumId = '333333333333333333',
    botId = '444444444444444444',
    threadId = '555555555555555555';
  const roles = [{ id: workScope.guildId, permissions: '8' }];
  let name = 'Old name',
    writes = 0;
  const fetcher: typeof fetch = (input, init) => {
    const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
    if (path.endsWith('/users/@me')) return Promise.resolve(Response.json({ id: botId }));
    if (path.endsWith('/roles')) return Promise.resolve(Response.json(roles));
    if (path.includes('/members/'))
      return Promise.resolve(
        Response.json({
          user: { id: path.split('/').at(-1), username: 'member' },
          roles: [],
          pending: false,
        }),
      );
    if (path.endsWith(forumId))
      return Promise.resolve(
        Response.json({
          id: forumId,
          guild_id: workScope.guildId,
          type: 15,
          parent_id: null,
          permission_overwrites: [],
          name: 'Forum',
        }),
      );
    if (path.endsWith(threadId)) {
      if (init?.method === 'PATCH') {
        assert.ok(typeof init.body === 'string');
        name = (JSON.parse(init.body) as { name: string }).name;
        writes++;
      }
      return Promise.resolve(
        Response.json({
          id: threadId,
          guild_id: workScope.guildId,
          type: 11,
          parent_id: forumId,
          name,
          thread_metadata: { archived: false, locked: false },
        }),
      );
    }
    throw new Error(`Unexpected Discord path ${path}`);
  };
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    const fingerprint = await workAudience(roles, [], forumId);
    const home = {
      id: 'home',
      scope: workScope,
      projectSourceId,
      projectId,
      destination: { kind: 'forum' as const, channelId: forumId, parentId: null },
      taskParent: null,
      audienceFingerprint: fingerprint,
      approvedBy: 'guest',
      state: 'active' as const,
      generation: 1,
    };
    const conversation = {
      id: 'overview',
      scope: workScope,
      subject: { kind: 'project_plan' as const, sourceId: projectSourceId, pageId: projectId },
      homeId: home.id,
      placementProjectId: projectId,
      threadId,
      starterMessageId: threadId,
      mode: 'selected' as const,
      state: 'active' as const,
      generation: 1,
      activationId: threadId,
      cursorId: threadId,
      windowUpperId: null,
      windowBeforeId: null,
      footerBlockIds: [],
      managedName: 'Old name',
    };
    await saveProjectHome(db, home, 0, workNow);
    await saveWorkConversation(db, conversation, 0, workNow);
    const actor = await resolveWorkActor(db, workScope, discordUserId);
    assert.ok(actor);
    assert.ok(project.properties.Name.title[0]);
    project.properties.Name.title[0].plain_text = 'New name';
    await enqueueWorkOperation(
      db,
      {
        id: 'rename',
        scope: workScope,
        homeId: home.id,
        conversationId: conversation.id,
        generation: 1,
        kind: 'refresh',
        sourceKey: 'rename',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: { intent: 'name-sync', target: 'thread', title: 'New name', revision: 'created' },
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
    const context = {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => workNow,
    };
    const result = await runDiscordWorkBatch(
      budget.db,
      { notion, discord },
      { ...context, stage: 'effects', deadline: Date.now() + 60_000, maxLinks: 1, maxEffects: 1 },
    );
    assert.equal(
      result.kind,
      'progress',
      `rename consumed ${budget.queries} queries: ${result.reason}`,
    );
    assert.equal(writes, 1);
    for (let i = 0; i < 9; i++)
      await saveWorkConversation(
        db,
        {
          ...conversation,
          id: `task-${i}`,
          subject: { kind: 'task', sourceId, pageId: `${taskId.slice(0, -1)}${i}` },
          threadId: `${600000000000000000n + BigInt(i)}`,
        },
        0,
        workNow,
      );
    const showBudget = queryBudget(db, 49);
    const showDiscord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: botId,
      botToken: 'fixture',
      allowWrites: true,
      fetch: fetcher,
      rateLimit: discordRateLimit(showBudget.db, botId, () => workNow),
    });
    const shown = await runWorkPreview(
      showBudget.db,
      { notion, discord: showDiscord },
      {
        applicationId: botId,
        guildId: workScope.guildId,
        discordUserId,
        channelId: forumId,
        interactionId: '777777777777777777',
        intent: { action: 'show' },
      },
      context,
    );
    assert.equal(shown.kind, 'ready');
    assert.ok(showBudget.queries <= 49);
    Object.assign(notion, { readPage: (id: string) => Promise.resolve({ ...project, id }) });
    for (let i = 0; i < 3; i++) {
      const id = `plan-${i}`;
      await saveWorkConversation(
        db,
        {
          ...conversation,
          id,
          subject: { ...conversation.subject, pageId: `${'a'.repeat(31)}${i}` },
          threadId: `${700000000000000000n + BigInt(i)}`,
        },
        0,
        workNow,
      );
      await enqueueWorkOperation(
        db,
        {
          id: `issue-${i}`,
          scope: workScope,
          homeId: home.id,
          conversationId: id,
          generation: 1,
          kind: 'refresh',
          sourceKey: `issue-${i}`,
          actorPersonId: actor.personId,
          actorDiscordId: discordUserId,
          grantVersion: actor.grantVersion,
          originalAuthorId: discordUserId,
          payload: { intent: 'name-sync', target: 'thread', title: 'Test', revision: 'created' },
        },
        workNow,
      );
      db.raw
        .prepare(
          "UPDATE discord_work_operations SET state='failed',reason='planning_post_locked' WHERE id=?",
        )
        .run(`issue-${i}`);
    }
    const populatedBudget = queryBudget(db, 49);
    const populatedDiscord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: botId,
      botToken: 'fixture',
      allowWrites: true,
      fetch: fetcher,
      rateLimit: discordRateLimit(populatedBudget.db, botId, () => workNow),
    });
    const populated = await runWorkPreview(
      populatedBudget.db,
      { notion, discord: populatedDiscord },
      {
        applicationId: botId,
        guildId: workScope.guildId,
        discordUserId,
        channelId: forumId,
        interactionId: '888888888888888888',
        intent: { action: 'show' },
      },
      context,
    );
    assert.match(JSON.stringify(populated), /post is locked/);
    assert.ok(populatedBudget.queries <= 49);
    project.properties.Name.title[0].plain_text = 'Later name';
    await enqueueWorkOperation(
      db,
      {
        id: 'notion-retry',
        scope: workScope,
        homeId: home.id,
        conversationId: conversation.id,
        generation: 1,
        kind: 'refresh',
        sourceKey: 'notion-retry',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: {
          intent: 'name-sync',
          target: 'thread',
          title: 'Later name',
          revision: 'created',
        },
      },
      workNow,
    );
    Object.assign(notion, {
      readPage: () => Promise.reject(new NotionTaskApiError('http_503', 1000)),
    });
    const retryBudget = queryBudget(db, 49);
    const retryDiscord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: botId,
      botToken: 'fixture',
      allowWrites: true,
      fetch: fetcher,
      rateLimit: discordRateLimit(retryBudget.db, botId, () => workNow),
    });
    const retry = await runDiscordWorkBatch(
      retryBudget.db,
      { notion, discord: retryDiscord },
      { ...context, stage: 'effects', deadline: Date.now() + 60_000, maxLinks: 1, maxEffects: 1 },
    );
    assert.equal(retry.reason, 'http_503');
    const retryRow = db.raw
      .prepare("SELECT state,result_json FROM discord_work_operations WHERE id='notion-retry'")
      .get();
    assert.ok(retryRow);
    assert.equal(retryRow.state, 'retryable');
    assert.equal(retryRow.result_json, null);
    assert.equal(writes, 1);
  } finally {
    db.raw.close();
  }
});
