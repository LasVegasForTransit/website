import assert from 'node:assert/strict';
import test from 'node:test';
import { saveProjectHome } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { seedActiveWorkRoute } from '@lasvegasfortransit/platform-storage/test-db';
import { claimWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { runWorkPreview } from '../src/discord-work-setup';
import { recoverOneWorkOperation } from '../src/discord-work-recovery';
import { processWorkAction } from '../src/discord-work-actions';
import { processWorkProvision } from '../src/discord-work-provision';
import { resolveWorkActor } from '../src/discord-work-authority';
import {
  discordUserId,
  sourceId,
  projectId,
  projectSourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

for (const projectLinked of [false, true])
  for (const lostResponse of [false, true])
    void test(`an administrator adopts an event thread ${projectLinked ? 'in its project forum' : 'in the events channel'} ${lostResponse ? 'after a lost response' : 'normally'}`, async () => {
      const { db, notion } = workFixture();
      const discord = new DiscordWorkClient({
        guildId: workScope.guildId,
        applicationId: '444444444444444444',
        botToken: 'fixture-only',
      });
      const eventId = '20000000-0000-4000-8000-000000000002',
        eventSource = '20000000-0000-4000-8000-000000000001',
        categoryId = '444444444444444445',
        parentId = '333333333333333333',
        threadId = '666666666666666666';
      Object.assign(notion, {
        readPage: (id: string) =>
          id.replaceAll('-', '') === projectId.replaceAll('-', '')
            ? Promise.resolve({
                object: 'page',
                id: projectId,
                parent: { data_source_id: projectSourceId },
              })
            : Promise.resolve({
                object: 'page',
                id: eventId,
                parent: { data_source_id: eventSource },
                properties: {
                  Name: { type: 'title', title: [{ plain_text: 'Event' }] },
                  Status: { type: 'status', status: { name: 'Planning' } },
                  Project: { type: 'relation', relation: [{ id: projectId }], has_more: false },
                },
              }),
      });
      let parent = parentId,
        privateThread = false,
        cards = 0;
      Object.assign(discord, {
        membership: () => Promise.resolve(true),
        inspectDestination: (id: string) =>
          Promise.resolve({
            isCategory: id === categoryId,
            privateThread: id === threadId && privateThread,
            destination: {
              kind: id === threadId ? 'thread' : projectLinked ? 'forum' : 'text',
              channelId: id,
              parentId:
                id === threadId ? parent : id === parentId && projectLinked ? categoryId : null,
            },
            audienceFingerprint: 'audience',
            canRead: true,
            canSend: true,
            canCreateThreads: true,
            canManageChannels: true,
            archived: false,
            locked: false,
            requiredTag: projectLinked && id === parentId,
            tags: [],
          }),
        sendCard: (id: string) => {
          assert.equal(id, threadId);
          cards++;
          if (lostResponse) return Promise.reject(new Error('response lost'));
          return Promise.resolve('777777777777777777');
        },
        createTaskConversation: () => {
          throw new Error('unexpected thread creation');
        },
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
        const actor = await resolveWorkActor(db, workScope, discordUserId);
        assert.ok(actor);
        if (projectLinked)
          await saveProjectHome(
            db,
            {
              id: 'project',
              scope: workScope,
              projectSourceId,
              projectId,
              destination: { kind: 'forum', channelId: parentId, parentId: categoryId },
              taskParent: null,
              audienceFingerprint: 'audience',
              approvedBy: actor.personId,
              state: 'active',
              generation: 1,
            },
            0,
            workNow,
          );
        seedActiveWorkRoute(
          db,
          {
            id: 'route',
            scope: workScope,
            sourceId: eventSource,
            kind: 'event',
            state: 'active',
            revision: 1,
            trigger: { property: 'Status', values: ['Planning'] },
            destination: projectLinked
              ? { kind: 'category', channelId: categoryId }
              : { kind: 'text', channelId: parentId },
            ...(projectLinked ? { projectRelation: { property: 'Project', projectSourceId } } : {}),
            approvedBy: actor.personId,
            approvedDiscordId: discordUserId,
            approvedGrantVersion: actor.grantVersion,
            audienceFingerprint: 'audience',
          },
          workNow,
        );
        const request = {
          ...base,
          intent: { action: 'adopt-event', url: `https://www.notion.so/${eventId}` },
        };
        parent = '999999999999999999';
        assert.match(
          JSON.stringify(await runWorkPreview(db, { notion, discord }, request, context)),
          /destination|thread/i,
        );
        parent = parentId;
        privateThread = true;
        assert.match(
          JSON.stringify(await runWorkPreview(db, { notion, discord }, request, context)),
          /Private threads cannot be adopted/,
        );
        privateThread = false;
        const preview = await runWorkPreview(db, { notion, discord }, request, context);
        assert.match(JSON.stringify(preview), /existing/i);
        const receipt = db.raw
          .prepare(
            "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='event' ORDER BY rowid DESC LIMIT 1",
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
        assert.equal(
          db.raw
            .prepare(
              "SELECT thread_id FROM discord_work_conversations WHERE json_extract(data_json,'$.subject.kind')='event_plan'",
            )
            .get()?.thread_id,
          threadId,
        );
        const blocks: Record<string, unknown>[] = [
          {
            id: 'organizer',
            type: 'paragraph',
            created_by: { id: 'person' },
            paragraph: { rich_text: [{ text: { content: 'Event details' } }] },
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
          /already has a conversation/,
        );
        assert.equal(cards, 1);
      } finally {
        db.raw.close();
      }
    });
