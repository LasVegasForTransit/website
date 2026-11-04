import assert from 'node:assert/strict';
import test from 'node:test';
import { saveProjectHome } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { currentWorkAudience } from '../src/discord-work-actions';
import {
  projectId,
  projectSourceId,
  sourceId,
  taskId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('a linked conversation must retain its approved audience, independently of the project forum', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  const homeId = '333333333333333333',
    threadId = '555555555555555555';
  let threadAudience = 'approved-thread',
    privateThread = false;
  Object.assign(discord, {
    inspectDestination: (id: string) =>
      Promise.resolve({
        audienceFingerprint: id === homeId ? 'approved-home' : threadAudience,
        privateThread: id === threadId && privateThread,
        canRead: true,
        locked: false,
      }),
  });
  const home = {
    id: 'home',
    scope: workScope,
    projectSourceId,
    projectId,
    destination: { kind: 'forum' as const, channelId: homeId, parentId: null },
    taskParent: null,
    audienceFingerprint: 'approved-home',
    approvedBy: 'guest',
    state: 'active' as const,
    generation: 1,
  };
  const conversation = {
    id: 'conversation',
    scope: workScope,
    subject: { kind: 'task' as const, sourceId, pageId: taskId },
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
    audienceFingerprint: 'approved-thread',
  };
  try {
    await saveProjectHome(db, home, 0, workNow);
    assert.equal(await currentWorkAudience(db, { notion, discord }, conversation), true);
    privateThread = true;
    assert.equal(await currentWorkAudience(db, { notion, discord }, conversation), false);
    privateThread = false;
    threadAudience = 'changed';
    assert.equal(await currentWorkAudience(db, { notion, discord }, conversation), false);
    threadAudience = 'approved-home';
    const { audienceFingerprint: _old, ...legacy } = conversation;
    assert.equal(await currentWorkAudience(db, { notion, discord }, legacy), true);
    threadAudience = 'changed';
    assert.equal(await currentWorkAudience(db, { notion, discord }, legacy), false);
  } finally {
    db.raw.close();
  }
});
