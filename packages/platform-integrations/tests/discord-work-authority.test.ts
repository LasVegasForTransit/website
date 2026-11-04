import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveProjectHome,
  saveWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  workFixture,
  workScope,
  sourceId,
  taskId,
  discordUserId,
  workNow,
  projectId,
  projectSourceId,
} from './support/discord-work';
import { authorizeWork } from '../src/discord-work-authority';

void test('authorization accepts equivalent Notion identities but rejects a different subject or project', async () => {
  const { db, notion, task } = workFixture();
  const compact = (id: string) => id.replaceAll('-', '').toUpperCase();
  const providers = { notion, discord: { membership: () => Promise.resolve(true) } };
  const subject = { kind: 'task' as const, sourceId, pageId: taskId };
  try {
    await saveProjectHome(
      db,
      {
        id: 'home',
        scope: workScope,
        projectSourceId,
        projectId: compact(projectId),
        destination: { kind: 'forum', channelId: '333333333333333333', parentId: null },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: 'guest',
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    await saveWorkConversation(
      db,
      {
        id: 'conversation',
        scope: workScope,
        subject: { ...subject, sourceId: compact(sourceId), pageId: compact(taskId) },
        homeId: 'home',
        placementProjectId: projectId,
        threadId: '555555555555555555',
        starterMessageId: '555555555555555555',
        mode: 'automatic',
        state: 'active',
        generation: 1,
        activationId: '555555555555555555',
        cursorId: '555555555555555555',
        windowUpperId: null,
        windowBeforeId: null,
        footerBlockIds: [],
      },
      0,
      workNow,
    );
    const input = {
      scope: workScope,
      subject,
      discordUserId,
      action: 'comment' as const,
      conversationId: 'conversation',
      generation: 1,
    };
    assert.equal((await authorizeWork(db, providers, input, workNow))?.personId, 'guest');
    assert.equal(
      await authorizeWork(
        db,
        providers,
        { ...input, subject: { ...subject, pageId: projectId } },
        workNow,
      ),
      null,
    );
    task.properties.Project.relation = [{ id: taskId }];
    assert.equal(await authorizeWork(db, providers, input, workNow), null);
  } finally {
    db.raw.close();
  }
});
void test('a verified Notion guest can update assigned shared work without DM consent; revoked assignments fail closed', async () => {
  const module = await import('../src/discord-work-authority').catch(() => null);
  assert.ok(module, 'shared authority checks exist');
  const { db, notion, task } = workFixture();
  const providers = { notion, discord: { membership: () => Promise.resolve(true) } };
  const input = {
    scope: workScope,
    subject: { kind: 'task' as const, sourceId, pageId: taskId },
    discordUserId,
    action: 'comment' as const,
  };
  try {
    assert.equal((await module.authorizeWork(db, providers, input, workNow))?.personId, 'guest');
    assert.equal(
      await module.authorizeWork(db, providers, { ...input, action: 'manage_home' }, workNow),
      null,
    );
    assert.equal(
      await module.authorizeWork(
        db,
        providers,
        { ...input, scope: { ...workScope, workspaceId: 'other' } },
        workNow,
      ),
      null,
    );
    task.properties.Assignee.people = [];
    assert.equal(await module.authorizeWork(db, providers, input, workNow), null);
    task.properties.Assignee.people = [{ id: 'notion-guest' }];
    db.raw.prepare("UPDATE identities SET link_method='created_by_platform'").run();
    assert.equal(await module.authorizeWork(db, providers, input, workNow), null);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM task_checkin_consents').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
