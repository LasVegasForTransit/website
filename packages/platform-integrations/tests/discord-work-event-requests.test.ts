import type { WorkConversation } from '../src/discord-work-types';
import { seedActiveWorkRoute } from '@lasvegasfortransit/platform-storage/test-db';
import assert from 'node:assert/strict';
import test from 'node:test';
import { recordWorkObservation } from '@lasvegasfortransit/platform-storage/discord-work-requests';
import { claimWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { resolveWorkActor } from '../src/discord-work-authority';
import { processWorkRouteRequest } from '../src/discord-work-route-requests';
import { processWorkProvision } from '../src/discord-work-provision';
import { refreshPlanningOverview } from '../src/discord-work-project-refresh';
import { processWorkAction } from '../src/discord-work-actions';
import { runWorkPreview } from '../src/discord-work-setup';
import { discordUserId, sourceId, workFixture, workNow, workScope } from './support/discord-work';

for (const kind of ['forum', 'text'] as const) {
  void test(`an event creates one ${kind === 'forum' ? 'forum post' : 'text thread'} and a backlink`, async () => {
    const { db, notion } = workFixture();
    const eventSource = '20000000-0000-4000-8000-000000000001',
      eventId = '20000000-0000-4000-8000-000000000002';
    const channelId = '333333333333333333',
      threadId = '555555555555555555';
    const discord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: '444444444444444444',
      botToken: 'fixture-only',
    });
    let created = 0,
      eventTitle = 'Community event',
      eventStatus = 'Planning';
    const edits: unknown[] = [];
    Object.assign(notion, {
      readPage: () =>
        Promise.resolve({
          object: 'page',
          id: eventId,
          parent: { data_source_id: eventSource },
          properties: {
            'Event name': { type: 'title', title: [{ plain_text: eventTitle }] },
            Status: { type: 'status', status: { name: eventStatus } },
          },
        }),
    });
    Object.assign(discord, {
      membership: () => Promise.resolve(true),
      inspectDestination: (id: string) =>
        Promise.resolve({
          destination: {
            kind: id === threadId ? 'thread' : kind,
            channelId: id,
            parentId: id === threadId ? channelId : null,
          },
          audienceFingerprint: 'audience',
          archived: false,
          locked: false,
          canRead: true,
          canSend: true,
          canCreateThreads: kind === 'text',
          canManageChannels: true,
          requiredTag: kind === 'forum',
          tags: [{ id: 'tag', name: 'Events' }],
        }),
      editCard: (input: unknown) => {
        edits.push(input);
        return Promise.resolve();
      },
      createTaskConversation: (input: { tagIds: string[] }) => {
        created++;
        assert.deepEqual(input.tagIds, kind === 'forum' ? ['tag'] : []);
        return Promise.resolve({ threadId, starterMessageId: threadId, cardChannelId: channelId });
      },
    });
    const context = {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => new Date(workNow.getTime() + 120_000),
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
      const route = {
        id: 'event-route',
        scope: workScope,
        sourceId: eventSource,
        kind: 'event' as const,
        state: 'active' as const,
        revision: 1,
        trigger: {
          property: 'Status',
          values: ['Planning', 'Pending review', 'Registration open'],
        },
        destination: { kind, channelId },
        tagIds: kind === 'forum' ? ['tag'] : [],
        approvedBy: actor.personId,
        approvedDiscordId: discordUserId,
        approvedGrantVersion: actor.grantVersion,
        audienceFingerprint: 'audience',
      };
      seedActiveWorkRoute(db, route, workNow);
      const observation = {
        scope: workScope,
        routeId: route.id,
        revision: 1,
        pageId: eventId,
        eligible: true,
        createdAt: new Date(workNow.getTime() + 1000),
        editedAt: new Date(workNow.getTime() + 1000),
      };
      await recordWorkObservation(db, observation, context.clock());
      eventStatus = 'Pending review';
      assert.equal(
        (await processWorkRouteRequest(db, { notion, discord }, context)).kind,
        'progress',
      );
      const op = await claimWorkOperation(db, workScope, context.clock());
      assert.ok(op);
      eventStatus = 'Registration open';
      assert.equal(
        (await processWorkProvision(db, { notion, discord }, op, context)).kind,
        'progress',
      );
      await recordWorkObservation(db, observation, context.clock());
      assert.equal(created, 1);
      assert.equal(
        db.raw
          .prepare("SELECT count(*) AS n FROM discord_work_operations WHERE kind='backlink'")
          .get()?.n,
        1,
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
      const backlink = await claimWorkOperation(db, workScope, context.clock());
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
      const row = db.raw
        .prepare(
          "SELECT data_json FROM discord_work_conversations WHERE json_extract(data_json,'$.subject.kind')='event_plan'",
        )
        .get();
      assert.ok(row);
      eventTitle = 'Updated event';
      assert.equal(
        (
          await refreshPlanningOverview(
            db,
            { notion, discord },
            JSON.parse(String(row.data_json)) as WorkConversation,
            context,
          )
        ).kind,
        'progress',
      );
      assert.equal(edits.length, 1);
      assert.match(JSON.stringify(edits[0]), /Updated event/);
      assert.match(JSON.stringify(edits[0]), /lvbt_work_create/);
      assert.equal(created, 1);
      db.raw
        .prepare("UPDATE identities SET link_method='created_by_platform' WHERE id='identity'")
        .run();
      eventTitle = 'Another event title';
      assert.equal(
        (
          await refreshPlanningOverview(
            db,
            { notion, discord },
            JSON.parse(String(row.data_json)) as WorkConversation,
            context,
          )
        ).kind,
        'paused',
      );
      assert.equal(edits.length, 1);
      db.raw.prepare("UPDATE identities SET link_method='self_linked' WHERE id='identity'").run();
      const input = {
        applicationId: '444444444444444444',
        guildId: workScope.guildId,
        discordUserId,
        channelId: threadId,
        interactionId: '777777777777777777',
        intent: { action: 'show' },
      };
      assert.match(
        JSON.stringify(await runWorkPreview(db, { notion, discord }, input, context)),
        /Updated event/,
      );
      await runWorkPreview(
        db,
        { notion, discord },
        { ...input, intent: { action: 'unlink' } },
        context,
      );
      assert.equal(
        db.raw
          .prepare(
            "SELECT state FROM discord_project_homes WHERE json_extract(data_json,'$.kind')='event'",
          )
          .get()?.state,
        'unlinked',
      );
      assert.equal(blocks.length, 3);
    } finally {
      db.raw.close();
    }
  });
}
