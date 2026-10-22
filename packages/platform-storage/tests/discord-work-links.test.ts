import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';

const scope = {
  environment: 'preview' as const,
  guildId: '222222222222222222',
  workspaceId: 'workspace',
};
const stamp = new Date('2026-10-22T12:00:00Z');
void test('shared links fence generations, isolate guilds and cancel queued writes on unlink', async () => {
  const links = await import('../src/discord-work-links').catch(() => null);
  const operations = await import('../src/discord-work-operations').catch(() => null);
  assert.ok(links, 'shared project placement storage exists');
  assert.ok(operations, 'shared effects have independent durable storage');
  const db = memoryDb();
  try {
    const home = {
      id: 'home',
      scope,
      projectSourceId: 'projects',
      projectId: 'project',
      destination: { kind: 'forum' as const, channelId: '333333333333333333', parentId: null },
      taskParent: null,
      audienceFingerprint: 'audience',
      approvedBy: 'person',
      state: 'active' as const,
      generation: 1,
    };
    assert.equal(await links.saveProjectHome(db, home, 0, stamp), true);
    assert.equal(await links.saveProjectHome(db, home, 0, stamp), false);
    assert.equal(
      await links.readProjectHome(db, { ...scope, guildId: '444444444444444444' }, 'home'),
      null,
    );
    const conversation = {
      id: 'conversation',
      scope,
      subject: { kind: 'task' as const, sourceId: 'tasks', pageId: 'task' },
      homeId: 'home',
      placementProjectId: 'project',
      threadId: '555555555555555555',
      starterMessageId: '555555555555555555',
      mode: 'automatic' as const,
      state: 'active' as const,
      generation: 1,
      activationId: '555555555555555555',
      cursorId: '555555555555555555',
      windowUpperId: null,
      windowBeforeId: null,
      footerBlockIds: [],
    };
    assert.equal(await links.saveWorkConversation(db, conversation, 0, stamp), true);
    assert.equal(
      await links.saveWorkConversation(db, { ...conversation, id: 'duplicate' }, 0, stamp),
      false,
    );
    const intent = {
      id: 'effect',
      scope,
      conversationId: conversation.id,
      homeId: home.id,
      generation: 1,
      kind: 'comment' as const,
      sourceKey: 'message:one',
      actorPersonId: null,
      actorDiscordId: '111111111111111111',
      grantVersion: 'grant',
      originalAuthorId: '111111111111111111',
      payload: { text: 'Progress' },
    };
    assert.equal(await operations.enqueueWorkOperation(db, intent, stamp), 'queued');
    assert.equal(
      await operations.enqueueWorkOperation(db, { ...intent, id: 'again' }, stamp),
      'duplicate',
    );
    assert.equal(
      await links.unlinkWork(db, { scope, id: conversation.id, generation: 1 }, stamp),
      true,
    );
    assert.equal(await operations.claimWorkOperation(db, scope, stamp), null);
    assert.equal(
      await operations.enqueueWorkOperation(
        db,
        { ...intent, id: 'stale', sourceKey: 'new' },
        stamp,
      ),
      'stale',
    );
    assert.equal(
      await links.unlinkWork(db, { scope, id: conversation.id, generation: 1 }, stamp),
      false,
    );
    assert.equal(
      await links.saveWorkConversation(
        db,
        {
          ...conversation,
          id: 'child',
          subject: { ...conversation.subject, pageId: 'other-task' },
        },
        0,
        stamp,
      ),
      true,
    );
    const provision = {
      ...intent,
      id: 'uncertain-home',
      conversationId: null,
      kind: 'provision' as const,
      sourceKey: 'setup:uncertain',
      payload: {
        intent: 'home',
        linkId: home.id,
        subject: { kind: 'project_plan', sourceId: 'projects', pageId: 'project' },
      },
    };
    await operations.enqueueWorkOperation(db, provision, stamp);
    const lease = await operations.claimWorkOperation(db, scope, stamp);
    assert.ok(lease);
    await operations.settleWorkOperation(
      db,
      { id: lease.id, token: lease.claim_token },
      { state: 'held' },
      stamp,
    );
    assert.equal(await links.unlinkWork(db, { scope, id: home.id, generation: 1 }, stamp), true);
    assert.equal((await links.readWorkConversation(db, scope, 'child'))?.state, 'unlinked');
    assert.equal(await links.saveProjectHome(db, { ...home, id: 'replacement' }, 0, stamp), true);
    assert.equal(
      await operations.enqueueWorkOperation(
        db,
        {
          ...provision,
          id: 'new-home-op',
          homeId: 'replacement',
          sourceKey: 'setup:replacement',
          payload: { ...provision.payload, linkId: 'replacement' },
        },
        stamp,
      ),
      'queued',
      'unlink releases an uncertain creation reservation',
    );
    assert.equal(
      await links.saveWorkConversation(
        db,
        {
          ...conversation,
          id: 'replacement-child',
          homeId: 'replacement',
          subject: { ...conversation.subject, pageId: 'other-task' },
        },
        0,
        stamp,
      ),
      true,
    );
  } finally {
    db.raw.close();
  }
});
