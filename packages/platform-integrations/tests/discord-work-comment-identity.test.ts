import assert from 'node:assert/strict';
import test from 'node:test';
import { saveProjectHome } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { enqueueWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { workMessageKey } from '../src/discord-work-ingest';
import {
  projectId,
  projectSourceId,
  workFixture,
  workNow,
  workScope,
  discordUserId,
} from './support/discord-work';

void test('manual and automatic saves deduplicate a message across Notion UUID spellings', async () => {
  const { db } = workFixture();
  const message = { channelId: '333333333333333333', id: '555555555555555555' };
  try {
    await saveProjectHome(
      db,
      {
        id: 'home',
        scope: workScope,
        projectSourceId,
        projectId,
        destination: { kind: 'text', channelId: message.channelId, parentId: null },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: 'guest',
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    const operation = {
      id: 'first',
      scope: workScope,
      homeId: 'home',
      conversationId: null,
      generation: 1,
      kind: 'comment' as const,
      sourceKey: `comment:${projectId}:${message.channelId}:${message.id}`,
      actorPersonId: 'guest',
      actorDiscordId: discordUserId,
      grantVersion: 'grant',
      originalAuthorId: discordUserId,
      payload: {},
    };
    assert.equal(await enqueueWorkOperation(db, operation, workNow), 'queued');
    const alternate = projectId.replaceAll('-', '').toUpperCase();
    assert.equal(workMessageKey(projectId, message), workMessageKey(alternate, message));
    assert.equal(
      await enqueueWorkOperation(
        db,
        { ...operation, id: 'second', sourceKey: workMessageKey(alternate, message) },
        workNow,
      ),
      'duplicate',
    );
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM discord_work_operations WHERE kind='comment'").get()
        ?.n,
      1,
    );
  } finally {
    db.raw.close();
  }
});

void test('comment recovery accepts equivalent Notion page ID formats', async () => {
  const { db, notion } = workFixture();
  const { claimWorkOperation, settleWorkOperation, readWorkOperation } =
    await import('@lasvegasfortransit/platform-storage/discord-work-operations');
  const { recoverWorkComment } = await import('../src/discord-work-actions');
  const compact = projectId.replaceAll('-', ''),
    channelId = '333333333333333333',
    messageId = '555555555555555555';
  try {
    await saveProjectHome(
      db,
      {
        id: 'home',
        scope: workScope,
        projectSourceId,
        projectId,
        destination: { kind: 'text', channelId, parentId: null },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: 'guest',
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    const operation = {
      id: 'effect',
      scope: workScope,
      homeId: 'home',
      conversationId: null,
      generation: 1,
      kind: 'comment' as const,
      sourceKey: 'comment-test',
      actorPersonId: 'guest',
      actorDiscordId: discordUserId,
      grantVersion: 'grant',
      originalAuthorId: discordUserId,
      payload: {},
    };
    await enqueueWorkOperation(db, operation, workNow);
    const claimed = await claimWorkOperation(db, workScope, workNow);
    assert.ok(claimed);
    await settleWorkOperation(
      db,
      { id: claimed.id, token: claimed.claim_token },
      { state: 'held' },
      workNow,
    );
    const held = await readWorkOperation(db, workScope, operation.id);
    assert.ok(held);
    const conversation = {
      id: 'selected',
      scope: workScope,
      subject: { kind: 'project_plan' as const, sourceId: projectSourceId, pageId: compact },
      homeId: 'home',
      placementProjectId: projectId,
      threadId: channelId,
      starterMessageId: messageId,
      mode: 'selected' as const,
      state: 'active' as const,
      generation: 1,
      activationId: messageId,
      cursorId: messageId,
      windowUpperId: null,
      windowBeforeId: null,
      footerBlockIds: [],
    };
    Object.assign(notion, {
      readSelf: () => Promise.resolve({ id: 'bot', type: 'bot' }),
      listTaskComments: () =>
        Promise.resolve({
          results: [
            {
              object: 'comment',
              id: 'notion-comment',
              created_by: { id: 'bot' },
              parent: { page_id: projectId },
              rich_text: [
                {
                  text: {
                    link: { url: `https://www.notion.so/${compact}?lvbt_work_update=effect` },
                  },
                },
              ],
            },
          ],
          nextCursor: null,
        }),
    });
    assert.equal(
      (
        await recoverWorkComment(
          db,
          notion,
          { scope: workScope, operation: held, conversation },
          workNow,
        )
      ).kind,
      'progress',
    );
    assert.equal((await readWorkOperation(db, workScope, operation.id))?.state, 'confirmed');
  } finally {
    db.raw.close();
  }
});
