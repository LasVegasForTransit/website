import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveProjectHome,
  saveWorkConversation,
  readProjectHome,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  enqueueWorkOperation,
  claimWorkOperation,
  settleWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { DiscordApiFailure } from '../src/discord-types';
import { resolveWorkActor } from '../src/discord-work-authority';
import { refreshPlanningOverview } from '../src/discord-work-project-refresh';
import { processWorkNameSync } from '../src/discord-work-name-sync';
import { runWorkPreview } from '../src/discord-work-setup';
import { recoverOneWorkOperation } from '../src/discord-work-recovery';
import { assertResolutionBlocked } from './support/discord-work-name-assertions';
import {
  discordUserId,
  projectId,
  projectSourceId,
  sourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('a renamed project refreshes its card and bot-managed names while retaining links', async () => {
  const { db, notion, project } = workFixture();
  const forumId = '333333333333333333',
    threadId = '555555555555555555',
    botCardId = '666666666666666666';
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  const edits: unknown[] = [];
  const names = new Map([
    [forumId, 'Old project title'],
    [threadId, 'Old project title'],
  ]);
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: (id: string) =>
      Promise.resolve({
        destination: {
          kind: id === forumId ? 'forum' : 'thread',
          channelId: id,
          parentId: id === forumId ? null : forumId,
        },
        audienceFingerprint: 'audience',
        canRead: true,
        privateThread: false,
        locked: false,
      }),
    editCard: (input: unknown) => {
      edits.push(input);
      return Promise.resolve();
    },
    readPlanningName: (id: string) => Promise.resolve(names.get(id)),
    updatePlanningName: (input: { channelId: string; expectedName: string; name: string }) => {
      assert.equal(names.get(input.channelId), input.expectedName);
      names.set(input.channelId, input.name);
      return Promise.resolve();
    },
  });
  const home = {
    id: 'home',
    scope: workScope,
    projectSourceId,
    projectId,
    destination: { kind: 'forum' as const, channelId: forumId, parentId: null },
    taskParent: null,
    audienceFingerprint: 'audience',
    approvedBy: 'guest',
    state: 'active' as const,
    generation: 1,
    title: 'Old project title',
    managedName: 'Old project title',
  };
  const conversation = {
    id: 'overview',
    scope: workScope,
    subject: { kind: 'project_plan' as const, sourceId: projectSourceId, pageId: projectId },
    homeId: home.id,
    placementProjectId: projectId,
    threadId,
    starterMessageId: botCardId,
    cardChannelId: threadId,
    mode: 'selected' as const,
    state: 'active' as const,
    generation: 1,
    activationId: botCardId,
    cursorId: botCardId,
    windowUpperId: null,
    windowBeforeId: null,
    footerBlockIds: [],
    managedName: 'Old project title',
  };
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    await saveProjectHome(db, home, 0, workNow);
    await saveWorkConversation(db, conversation, 0, workNow);
    const actor = await resolveWorkActor(db, workScope, discordUserId);
    assert.ok(actor);
    await enqueueWorkOperation(
      db,
      {
        id: 'provision',
        scope: workScope,
        homeId: home.id,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'provision',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: { intent: 'home', subject: conversation.subject },
      },
      workNow,
    );
    const op = await claimWorkOperation(db, workScope, workNow);
    assert.ok(op);
    await settleWorkOperation(
      db,
      { id: op.id, token: op.claim_token },
      { state: 'confirmed' },
      workNow,
    );
    assert.ok(project.properties.Name.title[0]);
    project.properties.Name.title[0].plain_text = 'Renamed project';
    Object.assign(project, { last_edited_time: workNow.toISOString() });
    const context = {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => workNow,
    };
    assert.equal(
      (await refreshPlanningOverview(db, { notion, discord }, conversation, context)).kind,
      'progress',
    );
    assert.equal(edits.length, 1);
    assert.match(JSON.stringify(edits[0]), /Renamed project/);
    for (let i = 0; i < 2; i++) {
      const nameOperation = await claimWorkOperation(db, workScope, workNow);
      assert.ok(nameOperation);
      assert.equal(
        (await processWorkNameSync(db, { notion, discord }, nameOperation, context)).kind,
        'progress',
      );
    }
    assert.equal(names.get(forumId), 'Renamed project');
    assert.equal(names.get(threadId), 'Renamed project');
    assert.equal((edits[0] as { channelId: string; messageId: string }).channelId, threadId);
    assert.equal((edits[0] as { channelId: string; messageId: string }).messageId, botCardId);
    assert.equal((await readProjectHome(db, workScope, home.id))?.destination.channelId, forumId);
    assert.equal((await readWorkConversation(db, workScope, conversation.id))?.threadId, threadId);
    assert.equal(
      (await refreshPlanningOverview(db, { notion, discord }, conversation, context)).kind,
      'idle',
    );
    assert.equal(edits.length, 1);
    names.set(forumId, 'Organizer title');
    project.properties.Name.title[0].plain_text = 'Another project title';
    Object.assign(project, { last_edited_time: new Date(workNow.getTime() + 1000).toISOString() });
    const refreshed = await readWorkConversation(db, workScope, conversation.id);
    assert.ok(refreshed);
    await refreshPlanningOverview(db, { notion, discord }, refreshed, context);
    for (let i = 0; i < 2; i++) {
      const nameOperation = await claimWorkOperation(db, workScope, workNow);
      assert.ok(nameOperation);
      await processWorkNameSync(db, { notion, discord }, nameOperation, context);
    }
    assert.equal(names.get(forumId), 'Organizer title');
    assert.equal(names.get(threadId), 'Another project title');
    const stoppedHome = await readProjectHome(db, workScope, home.id);
    assert.ok(stoppedHome);
    assert.equal(stoppedHome.managedName, null);
    assert.equal(stoppedHome.managedNameReason, 'planning_name_changed');
    const optedIn = await runWorkPreview(
      db,
      { notion, discord },
      {
        applicationId: '444444444444444444',
        guildId: workScope.guildId,
        discordUserId,
        channelId: forumId,
        interactionId: '777777777777777777',
        intent: { action: 'sync-name' },
      },
      context,
    );
    assert.match(JSON.stringify(optedIn), /Name sync enabled/);
    assert.equal((await readProjectHome(db, workScope, home.id))?.managedName, 'Organizer title');
    Object.assign(discord, {
      updatePlanningName: (input: { channelId: string; name: string }) => {
        if (input.channelId === threadId)
          return Promise.reject(new Error('planning_post_archived'));
        names.set(input.channelId, input.name);
        return Promise.resolve();
      },
    });
    project.properties.Name.title[0].plain_text = 'A later title';
    Object.assign(project, { last_edited_time: new Date(workNow.getTime() + 2000).toISOString() });
    const current = await readWorkConversation(db, workScope, conversation.id);
    assert.ok(current);
    await refreshPlanningOverview(db, { notion, discord }, current, context);
    for (let i = 0; i < 2; i++) {
      const nameOperation = await claimWorkOperation(db, workScope, workNow);
      assert.ok(nameOperation);
      await processWorkNameSync(db, { notion, discord }, nameOperation, context);
    }
    assert.equal(names.get(forumId), 'A later title');
    assert.equal(names.get(threadId), 'Another project title');
    assert.ok(
      db.raw
        .prepare(
          "SELECT 1 FROM discord_work_operations WHERE reason='planning_post_archived' AND state='failed'",
        )
        .get(),
    );
    const resume = await runWorkPreview(
      db,
      { notion, discord },
      {
        applicationId: '444444444444444444',
        guildId: workScope.guildId,
        discordUserId,
        channelId: threadId,
        interactionId: '888888888888888888',
        intent: { action: 'sync-name' },
      },
      context,
    );
    assert.match(JSON.stringify(resume), /Name sync enabled/);
    Object.assign(discord, {
      updatePlanningName: (input: { channelId: string; name: string }) => {
        names.set(input.channelId, input.name);
        return input.channelId === threadId
          ? Promise.reject(new Error('connection_lost'))
          : Promise.resolve();
      },
    });
    project.properties.Name.title[0].plain_text = 'Final project title';
    Object.assign(project, { last_edited_time: new Date(workNow.getTime() + 3000).toISOString() });
    const resumed = await readWorkConversation(db, workScope, conversation.id);
    assert.ok(resumed);
    await refreshPlanningOverview(db, { notion, discord }, resumed, context);
    for (let i = 0; i < 2; i++) {
      const nameOperation = await claimWorkOperation(db, workScope, workNow);
      assert.ok(nameOperation);
      await processWorkNameSync(db, { notion, discord }, nameOperation, context);
    }
    project.properties.Name.title[0].plain_text = 'Changed again';
    Object.assign(project, { last_edited_time: new Date(workNow.getTime() + 4000).toISOString() });
    const recoveryTime = new Date(workNow.getTime() + 61_000);
    const recoveryContext = { ...context, clock: () => recoveryTime };
    assert.equal(
      (await recoverOneWorkOperation(db, { notion, discord }, recoveryContext)).kind,
      'progress',
    );
    assert.equal(
      (await readWorkConversation(db, workScope, conversation.id))?.managedName,
      'Final project title',
    );
    let rateLimited = true;
    Object.assign(discord, {
      updatePlanningName: (input: { channelId: string; name: string }) => {
        if (input.channelId === threadId && rateLimited) {
          rateLimited = false;
          return Promise.reject(new DiscordApiFailure('rate_limited', 1000));
        }
        names.set(input.channelId, input.name);
        return Promise.resolve();
      },
    });
    project.properties.Name.title[0].plain_text = 'Retryable title';
    Object.assign(project, { last_edited_time: new Date(workNow.getTime() + 5000).toISOString() });
    const retryTime = new Date(workNow.getTime() + 120_000);
    const retryContext = { ...context, clock: () => retryTime };
    const retryConversation = await readWorkConversation(db, workScope, conversation.id);
    assert.ok(retryConversation);
    await refreshPlanningOverview(db, { notion, discord }, retryConversation, retryContext);
    for (let i = 0; i < 2; i++) {
      const nameOperation = await claimWorkOperation(db, workScope, retryTime);
      assert.ok(nameOperation);
      await processWorkNameSync(db, { notion, discord }, nameOperation, retryContext);
    }
    const retryRow = db.raw
      .prepare(
        "SELECT result_json FROM discord_work_operations WHERE state='retryable' AND reason='rate_limited'",
      )
      .get();
    assert.ok(retryRow);
    assert.equal(retryRow.result_json, null);
    const afterRateLimit = new Date(retryTime.getTime() + 2000);
    const retryOperation = await claimWorkOperation(db, workScope, afterRateLimit);
    assert.ok(retryOperation);
    assert.equal(
      (
        await processWorkNameSync(db, { notion, discord }, retryOperation, {
          ...context,
          clock: () => afterRateLimit,
        })
      ).kind,
      'progress',
    );
    assert.equal(names.get(threadId), 'Retryable title');
    Object.assign(discord, {
      updatePlanningName: (input: { channelId: string; name: string }) => {
        if (input.channelId === threadId) return Promise.reject(new Error('connection_lost'));
        names.set(input.channelId, input.name);
        return Promise.resolve();
      },
    });
    project.properties.Name.title[0].plain_text = 'Uncertain title';
    Object.assign(project, { last_edited_time: new Date(workNow.getTime() + 6000).toISOString() });
    const uncertainConversation = await readWorkConversation(db, workScope, conversation.id);
    assert.ok(uncertainConversation);
    await refreshPlanningOverview(db, { notion, discord }, uncertainConversation, retryContext);
    for (let i = 0; i < 2; i++) {
      const op = await claimWorkOperation(db, workScope, retryTime);
      assert.ok(op);
      await processWorkNameSync(db, { notion, discord }, op, retryContext);
    }
    const unresolved = db.raw
      .prepare(
        "SELECT 1 FROM discord_work_operations WHERE state='held' AND reason='unconfirmed_effect'",
      )
      .get();
    assert.ok(unresolved);
    const reviewContext = { ...context, clock: () => new Date(retryTime.getTime() + 16_000) };
    await assertResolutionBlocked({
      db,
      providers: { notion, discord },
      conversation,
      threadId,
      context: reviewContext,
    });
    const resolved = await runWorkPreview(
      db,
      { notion, discord },
      {
        applicationId: '444444444444444444',
        guildId: workScope.guildId,
        discordUserId,
        channelId: threadId,
        interactionId: '999999999999999999',
        intent: { action: 'resolve-name' },
      },
      reviewContext,
    );
    assert.match(JSON.stringify(resolved), /Held update resolved/);
    assert.equal(
      (await readWorkConversation(db, workScope, conversation.id))?.managedName,
      'Retryable title',
    );
    assert.equal(
      db.raw
        .prepare(
          "SELECT 1 FROM discord_work_operations WHERE state='held' AND reason='unconfirmed_effect'",
        )
        .get(),
      undefined,
    );
    assert.ok(project.properties.Name.title[0]);
    project.properties.Name.title[0].plain_text = 'Changed again';
    db.raw
      .prepare("UPDATE identities SET link_method='created_by_platform' WHERE person_id='guest'")
      .run();
    assert.equal(
      (await refreshPlanningOverview(db, { notion, discord }, conversation, context)).kind,
      'paused',
    );
    assert.equal(edits.length, 6);
  } finally {
    db.raw.close();
  }
});
