import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveWorkRoute,
  readWorkRoute,
  activateWorkRoute,
} from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { requestWorkRouteBaseline } from '@lasvegasfortransit/platform-storage/discord-work-route-scans';
import {
  saveProjectHome,
  saveWorkConversation,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  enqueueWorkOperation,
  claimWorkOperation,
  settleWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { resolveWorkActor } from '../src/discord-work-authority';
import { runWorkPreview } from '../src/discord-work-setup';
import { runWorkRouteScan } from '../src/discord-work-route-scan';
import { refreshPlanningOverview } from '../src/discord-work-project-refresh';
import { runDiscordWorkBatch } from '../src/discord-work-runner';
import {
  discordUserId,
  sourceId,
  taskId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('a reviewed event mapping reaches an existing forum post through scheduled work', async () => {
  const { db, notion, task } = workFixture();
  const forumId = '333333333333333333',
    threadId = '555555555555555555',
    tagId = '777777777777777777',
    doneTag = '888888888888888888',
    humanTag = '666666666666666666';
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let tags: string[] = [humanTag],
    writes = 0;
  Object.assign(notion, {
    readDataSource: () =>
      Promise.resolve({
        object: 'data_source',
        id: sourceId,
        title: [{ plain_text: 'Events' }],
        properties: {
          Stage: { type: 'select', select: { options: [{ name: 'Ready' }, { name: 'Done' }] } },
          Status: { type: 'status', status: { options: [{ name: 'Planning' }] } },
        },
      }),
    queryWorkSource: () => Promise.resolve({ results: [], nextCursor: null }),
  });
  Object.assign(task.properties, { Stage: { type: 'select', select: { name: 'Ready' } } });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: (id: string) =>
      Promise.resolve({
        isCategory: false,
        destination: {
          kind: id === threadId ? 'thread' : 'forum',
          channelId: id,
          parentId: id === threadId ? forumId : null,
        },
        audienceFingerprint: 'audience',
        archived: false,
        locked: false,
        privateThread: false,
        canRead: true,
        canSend: true,
        canCreateThreads: true,
        canManageChannels: true,
        requiredTag: false,
        tags: [
          { id: tagId, name: 'Ready' },
          { id: doneTag, name: 'Done' },
          { id: humanTag, name: 'Volunteer' },
        ],
      }),
    readForumTags: () => Promise.resolve(tags),
    updateForumTags: (input: { expectedTags: string[]; tags: string[] }) => {
      assert.deepEqual(input.expectedTags, tags);
      tags = input.tags;
      writes++;
      return Promise.resolve();
    },
  });
  const base = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: forumId,
    interactionId: '999999999999999999',
  };
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
  const receipt = (intent: string) =>
    db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(intent)?.id;
  const act = (action: string, linkId: unknown, value?: string) =>
    runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action, linkId: String(linkId), value } },
      context,
    );
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    const actor = await resolveWorkActor(db, workScope, discordUserId);
    assert.ok(actor);
    const route = {
      id: 'events',
      scope: workScope,
      sourceId,
      kind: 'event' as const,
      state: 'paused' as const,
      revision: 1,
      trigger: { property: 'Status', values: ['Planning'] },
      destination: { kind: 'forum' as const, channelId: forumId },
      approvedBy: actor.personId,
      audienceFingerprint: 'audience',
    };
    assert.equal(await saveWorkRoute(db, actor, { route: route, expected: 0 }, workNow), true);
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'routes' } },
      context,
    );
    await act('route-manage', receipt('route-list'), route.id);
    await act('route-tags-start', receipt('route-manage'));
    const setup = receipt('tag-setup');
    assert.ok(setup);
    await act('route-tags-field', setup, 'Stage');
    await act('route-tags-value', setup, tagId);
    await act('route-tags-value', setup, doneTag);
    assert.match(JSON.stringify(await act('route-tags-save', setup)), /saved/i);
    const mapped = await readWorkRoute(db, workScope, route.id);
    assert.ok(mapped);
    assert.equal(
      await requestWorkRouteBaseline(
        db,
        actor,
        { scope: workScope, routeId: route.id, revision: mapped.revision },
        workNow,
      ),
      true,
    );
    assert.equal((await runWorkRouteScan(db, notion, workScope, () => workNow)).kind, 'progress');
    assert.equal(
      await activateWorkRoute(
        db,
        actor,
        {
          scope: workScope,
          id: route.id,
          expected: mapped.revision,
          approval: {
            discordUserId,
            grantVersion: actor.grantVersion,
            audienceFingerprint: 'audience',
          },
        },
        workNow,
      ),
      true,
    );
    const home = {
      kind: 'event' as const,
      id: 'event',
      scope: workScope,
      projectSourceId: sourceId,
      projectId: taskId,
      destination: { kind: 'forum' as const, channelId: forumId, parentId: null },
      taskParent: null,
      audienceFingerprint: 'audience',
      approvedBy: actor.personId,
      state: 'active' as const,
      generation: 1,
      title: 'Prepare agenda',
    };
    const conversation = {
      id: 'event-thread',
      scope: workScope,
      subject: { kind: 'event_plan' as const, sourceId, pageId: taskId },
      homeId: home.id,
      placementProjectId: taskId,
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
    };
    await saveProjectHome(db, home, 0, workNow);
    await saveWorkConversation(db, conversation, 0, workNow);
    await enqueueWorkOperation(
      db,
      {
        id: 'origin',
        scope: workScope,
        homeId: home.id,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'origin',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: { intent: 'event', subject: conversation.subject },
      },
      workNow,
    );
    const origin = await claimWorkOperation(db, workScope, workNow);
    assert.ok(origin);
    await settleWorkOperation(
      db,
      { id: origin.id, token: origin.claim_token },
      { state: 'confirmed' },
      workNow,
    );
    assert.equal(
      (await refreshPlanningOverview(db, { notion, discord }, conversation, context)).kind,
      'progress',
    );
    assert.equal(
      (
        await runDiscordWorkBatch(
          db,
          { notion, discord },
          {
            ...context,
            stage: 'effects',
            deadline: workNow.getTime() + 60000,
            maxLinks: 1,
            maxEffects: 1,
          },
        )
      ).kind,
      'progress',
    );
    assert.deepEqual(tags, [humanTag, tagId]);
    assert.equal(writes, 1);
    assert.deepEqual(
      (await readWorkConversation(db, workScope, conversation.id))?.managedForumTags,
      { routeId: route.id, tagIds: [tagId] },
    );
    Object.assign(task.properties, { Stage: { type: 'select', select: { name: 'Done' } } });
    task.last_edited_time = '2026-10-22T12:00:01.000Z';
    assert.equal(
      (await refreshPlanningOverview(db, { notion, discord }, conversation, context)).kind,
      'progress',
    );
    assert.equal(
      (
        await runDiscordWorkBatch(
          db,
          { notion, discord },
          {
            ...context,
            stage: 'effects',
            deadline: workNow.getTime() + 60000,
            maxLinks: 1,
            maxEffects: 1,
          },
        )
      ).kind,
      'progress',
    );
    assert.deepEqual(tags, [humanTag, doneTag]);
    assert.equal(writes, 2);
    assert.deepEqual(
      (await readWorkConversation(db, workScope, conversation.id))?.managedForumTags,
      { routeId: route.id, tagIds: [doneTag] },
    );
  } finally {
    db.raw.close();
  }
});
