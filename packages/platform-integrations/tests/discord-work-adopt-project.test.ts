import assert from 'node:assert/strict';
import test from 'node:test';
import { claimWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { runWorkPreview } from '../src/discord-work-setup';
import { recoverOneWorkOperation } from '../src/discord-work-recovery';
import { processWorkAction } from '../src/discord-work-actions';
import { processWorkProvision } from '../src/discord-work-provision';
import { runQueuedProjectPins } from './support/discord-work-pins';
import {
  discordUserId,
  projectId,
  sourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

for (const lostResponse of [false, true])
  void test(`an administrator adopts an existing project overview ${lostResponse ? 'after a lost response' : 'normally'}`, async () => {
    const { db, notion } = workFixture();
    const discord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: '444444444444444444',
      botToken: 'fixture-only',
    });
    const forumId = '555555555555555555',
      threadId = '666666666666666666',
      categoryId = '333333333333333333';
    let audience = 'audience',
      posts = 0,
      cards = 0;
    Object.assign(discord, {
      membership: () => Promise.resolve(true),
      inspectDestination: (id: string) =>
        Promise.resolve({
          isCategory: false,
          privateThread: false,
          destination: {
            kind: id === threadId ? 'thread' : 'forum',
            channelId: id,
            parentId: id === threadId ? forumId : categoryId,
          },
          audienceFingerprint: id === threadId ? audience : 'audience',
          canRead: true,
          canSend: true,
          canCreateThreads: true,
          canManageChannels: true,
          archived: false,
          locked: false,
          requiredTag: false,
          tags: [],
        }),
      sendCard: (id: string) => {
        assert.equal(id, threadId);
        cards++;
        if (lostResponse) return Promise.reject(new Error('response lost'));
        return Promise.resolve('777777777777777777');
      },
      createTaskConversation: () => {
        posts++;
        throw new Error('unexpected post');
      },
      pinWorkMessage: () => Promise.resolve(),
    });
    let now = workNow;
    const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => now };
    const base = {
      applicationId: '444444444444444444',
      guildId: workScope.guildId,
      discordUserId,
      channelId: threadId,
      interactionId: '777777777777777777',
    };
    try {
      db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
      db.raw
        .prepare(
          "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
        )
        .run(workNow.toISOString());
      const request = {
        ...base,
        intent: { action: 'adopt-project', url: `https://www.notion.so/${projectId}` },
      };
      audience = 'changed';
      assert.match(
        JSON.stringify(await runWorkPreview(db, { notion, discord }, request, context)),
        /audience|forum/i,
      );
      audience = 'audience';
      assert.match(
        JSON.stringify(await runWorkPreview(db, { notion, discord }, request, context)),
        /existing/i,
      );
      const receipt = db.raw
        .prepare(
          "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='home' ORDER BY rowid DESC LIMIT 1",
        )
        .get();
      assert.ok(receipt);
      assert.match(
        JSON.stringify(
          await runWorkPreview(
            db,
            { notion, discord },
            { ...base, intent: { action: 'confirm', linkId: String(receipt.id) } },
            context,
          ),
        ),
        /processing/i,
      );
      const op = await claimWorkOperation(db, workScope, workNow);
      assert.ok(op);
      const first = await processWorkProvision(db, { notion, discord }, op, context);
      if (lostResponse) {
        assert.equal(first.kind, 'paused');
        Object.assign(discord, {
          discoverWork: (input: { destinationId: string }) => {
            assert.equal(input.destinationId, threadId);
            return Promise.resolve({
              threadId,
              starterMessageId: '777777777777777777',
              cardChannelId: threadId,
            });
          },
        });
        now = new Date(workNow.getTime() + 120_000);
        assert.equal(
          (await recoverOneWorkOperation(db, { notion, discord }, context)).kind,
          'progress',
        );
        const resumed = await claimWorkOperation(db, workScope, now);
        assert.ok(resumed);
        assert.equal(
          (await processWorkProvision(db, { notion, discord }, resumed, context)).kind,
          'progress',
        );
      } else assert.equal(first.kind, 'progress');
      assert.equal(cards, 1);
      assert.equal(posts, 0);
      const c = db.raw
        .prepare(
          "SELECT thread_id FROM discord_work_conversations WHERE json_extract(data_json,'$.subject.kind')='project_plan'",
        )
        .get();
      assert.equal(c?.thread_id, threadId);
      const blocks: Record<string, unknown>[] = [
        {
          id: 'organizer',
          type: 'paragraph',
          created_by: { id: 'person' },
          paragraph: { rich_text: [{ text: { content: 'Project details' } }] },
        },
      ];
      Object.assign(notion, {
        readSelf: () => Promise.resolve({ id: 'bot', type: 'bot' }),
        listBlockChildren: () => Promise.resolve({ results: blocks, nextCursor: null }),
        appendBlockChildren: (_page: string, children: Record<string, unknown>[]) => {
          const added = children.map((block, index) => ({
            ...block,
            id: `block-${index}`,
            created_by: { id: 'bot' },
          }));
          blocks.push(...added);
          return Promise.resolve({ results: added });
        },
      });
      await runQueuedProjectPins(db, { notion, discord }, context);
      const backlink = await claimWorkOperation(db, workScope, now);
      assert.ok(backlink);
      assert.equal(
        (await processWorkAction(db, { notion, discord }, backlink, context)).kind,
        'progress',
      );
      assert.deepEqual(
        blocks.map((block) => block.type),
        ['paragraph', 'divider', 'paragraph'],
      );
      assert.match(
        JSON.stringify(blocks[2]),
        new RegExp(`discord\\.com/channels/${workScope.guildId}/${threadId}`),
      );
      assert.match(
        JSON.stringify(await runWorkPreview(db, { notion, discord }, request, context)),
        /already|linked/i,
      );
    } finally {
      db.raw.close();
    }
  });
