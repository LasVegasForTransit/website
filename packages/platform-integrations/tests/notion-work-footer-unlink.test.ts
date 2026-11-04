import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveProjectHome,
  saveWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { NotionTaskClient } from '../src/notion-task-client';
import { ensureNotionWorkLink } from '../src/notion-work-links';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { resolveWorkActor } from '../src/discord-work-authority';
import { processWorkAction } from '../src/discord-work-actions';
import {
  enqueueWorkOperation,
  claimWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import {
  projectId,
  projectSourceId,
  sourceId,
  taskId,
  workFixture,
  workNow,
  workScope,
  discordUserId,
} from './support/discord-work';

for (const scenario of ['create', 'move', 'before-scan'] as const) {
  void test(`unlink ${scenario} prevents a footer write and supersedes the operation`, async () => {
    const { db } = workFixture();
    const blocks: Record<string, unknown>[] = [];
    let unlinkOnRead = false;
    const client = new NotionTaskClient('fixture', (input, init) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      if (path.endsWith('/users/me'))
        return Promise.resolve(Response.json({ id: 'bot', type: 'bot' }));
      if (init?.method === 'PATCH') {
        assert.ok(typeof init.body === 'string');
        const body = JSON.parse(init.body) as { children: Record<string, unknown>[] };
        const created = body.children.map((block, i) => ({
          ...block,
          id: `${blocks.length + i + 1}`.padStart(32, '0'),
          created_by: { id: 'bot' },
        }));
        blocks.push(...created);
        return Promise.resolve(
          Response.json({ results: created, has_more: false, next_cursor: null }),
        );
      }
      const response = Response.json({ results: blocks, has_more: false, next_cursor: null });
      if (unlinkOnRead)
        db.raw
          .prepare(
            "UPDATE discord_work_conversations SET state='unlinked',generation=2,data_json=json_set(data_json,'$.state','unlinked','$.generation',2) WHERE id='c'",
          )
          .run();
      return Promise.resolve(response);
    });
    const home = {
      id: 'h',
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
      id: 'c',
      scope: workScope,
      subject: { kind: 'task' as const, sourceId, pageId: taskId },
      homeId: 'h',
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
    try {
      await saveProjectHome(db, home, 0, workNow);
      await saveWorkConversation(db, c, 0, workNow);
      if (scenario === 'move') {
        await ensureNotionWorkLink(db, client, c, workNow);
        blocks.push({
          id: 'human',
          type: 'paragraph',
          created_by: { id: 'human' },
          paragraph: { rich_text: [] },
        });
      }
      const before = JSON.stringify(blocks);
      const actor = await resolveWorkActor(db, workScope, discordUserId);
      assert.ok(actor);
      await enqueueWorkOperation(
        db,
        {
          id: 'backlink',
          scope: workScope,
          homeId: home.id,
          conversationId: c.id,
          generation: 1,
          kind: 'backlink',
          sourceKey: 'backlink:c',
          actorPersonId: actor.personId,
          actorDiscordId: discordUserId,
          grantVersion: actor.grantVersion,
          originalAuthorId: discordUserId,
          payload: {},
        },
        workNow,
      );
      const operation = await claimWorkOperation(db, workScope, workNow);
      assert.ok(operation);
      const discord = new DiscordWorkClient({
        guildId: workScope.guildId,
        applicationId: '444444444444444444',
        botToken: 'fixture',
      });
      Object.assign(discord, { membership: () => Promise.resolve(true) });
      if (scenario === 'before-scan')
        db.raw
          .prepare(
            "UPDATE discord_work_conversations SET state='unlinked',generation=2,data_json=json_set(data_json,'$.state','unlinked','$.generation',2) WHERE id='c'",
          )
          .run();
      else unlinkOnRead = true;
      await processWorkAction(db, { notion: client, discord }, operation, {
        scope: workScope,
        taskSourceId: sourceId,
        enabled: true,
        clock: () => workNow,
      });
      assert.equal(JSON.stringify(blocks), before);
      assert.equal(
        db.raw.prepare("SELECT state FROM discord_work_operations WHERE id='backlink'").get()
          ?.state,
        'superseded',
      );
    } finally {
      db.raw.close();
    }
  });
}
