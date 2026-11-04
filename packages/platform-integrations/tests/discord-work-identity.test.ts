import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findWorkSubject,
  saveProjectHome,
  saveWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  projectId,
  projectSourceId,
  sourceId,
  taskId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('equivalent Notion UUID spellings cannot create duplicate homes or conversations', async () => {
  const { db } = workFixture();
  const home = {
    id: 'home',
    scope: workScope,
    projectSourceId,
    projectId,
    destination: { kind: 'forum' as const, channelId: '333333333333333333', parentId: null },
    taskParent: null,
    audienceFingerprint: 'audience',
    approvedBy: 'guest',
    state: 'active' as const,
    generation: 1,
  };
  const c = {
    id: 'conversation',
    scope: workScope,
    subject: { kind: 'task' as const, sourceId, pageId: taskId },
    homeId: home.id,
    placementProjectId: projectId,
    threadId: '555555555555555555',
    starterMessageId: '555555555555555555',
    mode: 'selected' as const,
    state: 'active' as const,
    generation: 1,
    activationId: '555555555555555555',
    cursorId: '555555555555555555',
    windowUpperId: null,
    windowBeforeId: null,
    footerBlockIds: [],
  };
  const compact = (value: string) => value.replaceAll('-', '').toUpperCase();
  try {
    assert.equal(await saveProjectHome(db, home, 0, workNow), true);
    assert.equal(
      await saveProjectHome(
        db,
        {
          ...home,
          id: 'duplicate',
          projectSourceId: compact(projectSourceId),
          projectId: compact(projectId),
        },
        0,
        workNow,
      ),
      false,
    );
    assert.equal(await saveWorkConversation(db, c, 0, workNow), true);
    db.raw
      .prepare('UPDATE discord_work_conversations SET subject_key=? WHERE id=?')
      .run(JSON.stringify([c.subject.kind, c.subject.sourceId, c.subject.pageId]), c.id);
    const alternate = { ...c.subject, sourceId: compact(sourceId), pageId: compact(taskId) };
    assert.equal((await findWorkSubject(db, workScope, alternate))?.id, c.id);
    assert.equal(
      await saveWorkConversation(
        db,
        { ...c, id: 'duplicate-conversation', subject: alternate, threadId: '666666666666666666' },
        0,
        workNow,
      ),
      false,
    );
  } finally {
    db.raw.close();
  }
});
