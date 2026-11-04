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
import { resolveWorkActor } from '../src/discord-work-authority';
import { refreshPlanningOverview } from '../src/discord-work-project-refresh';
import {
  discordUserId,
  projectId,
  projectSourceId,
  sourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('a renamed project refreshes its bot-authored card without changing its forum or overview link', async () => {
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
    assert.equal((edits[0] as { channelId: string; messageId: string }).channelId, threadId);
    assert.equal((edits[0] as { channelId: string; messageId: string }).messageId, botCardId);
    assert.equal((await readProjectHome(db, workScope, home.id))?.destination.channelId, forumId);
    assert.equal((await readWorkConversation(db, workScope, conversation.id))?.threadId, threadId);
    assert.equal(
      (await refreshPlanningOverview(db, { notion, discord }, conversation, context)).kind,
      'idle',
    );
    assert.equal(edits.length, 1);
    assert.ok(project.properties.Name.title[0]);
    project.properties.Name.title[0].plain_text = 'Changed again';
    db.raw
      .prepare("UPDATE identities SET link_method='created_by_platform' WHERE person_id='guest'")
      .run();
    assert.equal(
      (await refreshPlanningOverview(db, { notion, discord }, conversation, context)).kind,
      'paused',
    );
    assert.equal(edits.length, 1);
  } finally {
    db.raw.close();
  }
});

void test('an event rename and reschedule retain the linked Discord thread', async () => {
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
  });
  const home = {
    kind: 'event' as const,
    id: 'event',
    scope: workScope,
    projectSourceId,
    projectId,
    destination: { kind: 'forum' as const, channelId: forumId, parentId: null },
    taskParent: null,
    audienceFingerprint: 'audience',
    approvedBy: 'guest',
    state: 'active' as const,
    generation: 1,
    title: 'Old event',
  };
  const conversation = {
    id: 'event-thread',
    scope: workScope,
    subject: { kind: 'event_plan' as const, sourceId: projectSourceId, pageId: projectId },
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
        id: 'event-provision',
        scope: workScope,
        homeId: home.id,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'event-provision',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: { intent: 'event', subject: conversation.subject },
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
    project.properties.Name.title[0].plain_text = 'Rescheduled event';
    Object.assign(project.properties, { Date: { type: 'date', date: { start: '2027-03-15' } } });
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
    assert.equal((edits[0] as { channelId: string; messageId: string }).channelId, threadId);
    assert.equal((edits[0] as { channelId: string; messageId: string }).messageId, botCardId);
    assert.match(JSON.stringify(edits[0]), /Rescheduled event/);
    assert.equal((await readProjectHome(db, workScope, home.id))?.destination.channelId, forumId);
    assert.equal((await readWorkConversation(db, workScope, conversation.id))?.threadId, threadId);
    Object.assign(project.properties, { Date: { type: 'date', date: { start: '2027-04-15' } } });
    assert.equal(
      (await refreshPlanningOverview(db, { notion, discord }, conversation, context)).kind,
      'idle',
    );
    assert.equal(edits.length, 1);
    assert.equal((await readWorkConversation(db, workScope, conversation.id))?.threadId, threadId);
  } finally {
    db.raw.close();
  }
});
