import { seedActiveWorkRoute } from '@lasvegasfortransit/platform-storage/test-db';
import assert from 'node:assert/strict';
import test from 'node:test';
import { recordWorkObservation } from '@lasvegasfortransit/platform-storage/discord-work-requests';
import { claimWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { resolveWorkActor } from '../src/discord-work-authority';
import { processWorkRouteRequest } from '../src/discord-work-route-requests';
import { processWorkProvision } from '../src/discord-work-provision';
import { processWorkAction } from '../src/discord-work-actions';
import { runWorkPreview } from '../src/discord-work-setup';
import { refreshPlanningOverview } from '../src/discord-work-project-refresh';
import { readWorkConversation } from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  discordUserId,
  projectId,
  projectSourceId,
  sourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

for (const race of [false, true]) {
  void test(`an eligible project creates its own forum and a durable backlink operation once (eligibility race: ${race})`, async () => {
    const { db, notion, project } = workFixture();
    const discord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: '444444444444444444',
      botToken: 'fixture-only',
    });
    const categoryId = '333333333333333333',
      forumId = '666666666666666666',
      threadId = '555555555555555555';
    let forums = 0,
      posts = 0,
      postPins = 0;
    let overviewCard: unknown;
    const inspection = {
      audienceFingerprint: 'audience',
      archived: false,
      locked: false,
      canRead: true,
      canSend: true,
      canCreateThreads: true,
      canManageChannels: true,
      requiredTag: false,
      tags: [],
    };
    Object.assign(discord, {
      membership: () => Promise.resolve(true),
      inspectDestination: (id: string) =>
        Promise.resolve({
          ...inspection,
          isCategory: id === categoryId,
          destination: {
            kind: 'forum',
            channelId: id,
            parentId: id === forumId ? categoryId : null,
          },
        }),
      createProjectForum: () => {
        forums++;
        return Promise.resolve({ kind: 'forum', channelId: forumId, parentId: categoryId });
      },
      createTaskConversation: (input: { card: unknown }) => {
        const checkpoint = db.raw
          .prepare(
            "SELECT result_json FROM discord_work_operations WHERE kind='provision' AND state='processing'",
          )
          .get();
        assert.ok(checkpoint);
        assert.equal(
          (JSON.parse(String(checkpoint.result_json)) as { postPhase?: string }).postPhase,
          'attempted',
        );
        posts++;
        overviewCard = input.card;
        return Promise.resolve({ threadId, starterMessageId: threadId, cardChannelId: threadId });
      },
      pinForumPost: (parent: string, thread: string) => {
        assert.equal(parent, forumId);
        assert.equal(thread, threadId);
        postPins++;
        return Promise.resolve();
      },
    });
    Object.assign(notion, {
      readPage: () =>
        Promise.resolve({
          ...project,
          properties: {
            ...project.properties,
            Status: { type: 'status', status: { name: 'Planning' } },
          },
        }),
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
        id: 'route',
        scope: workScope,
        sourceId: projectSourceId,
        kind: 'project' as const,
        state: 'active' as const,
        revision: 1,
        trigger: { property: 'Status', values: ['Planning'] },
        destination: { kind: 'category' as const, channelId: categoryId },
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
        pageId: projectId,
        eligible: true,
        createdAt: new Date(workNow.getTime() + 1000),
        editedAt: new Date(workNow.getTime() + 1000),
      };
      await recordWorkObservation(db, observation, context.clock());
      assert.equal(
        (await processWorkRouteRequest(db, { notion, discord }, context)).kind,
        'progress',
      );
      let operation = await claimWorkOperation(db, workScope, context.clock());
      assert.ok(operation);
      if (race) {
        const readEligible = notion.readPage.bind(notion);
        const older = new Date(workNow.getTime() + 2000);
        const newer = new Date(workNow.getTime() + 3000);
        Object.assign(notion, {
          readPage: async () => {
            await recordWorkObservation(
              db,
              { ...observation, eligible: false, editedAt: older },
              context.clock(),
            );
            await recordWorkObservation(
              db,
              { ...observation, eligible: true, editedAt: newer },
              context.clock(),
            );
            return {
              ...project,
              last_edited_time: older.toISOString(),
              properties: {
                ...project.properties,
                Status: { type: 'status', status: { name: 'Done' } },
              },
            };
          },
        });
        assert.equal(
          (await processWorkProvision(db, { notion, discord }, operation, context)).reason,
          'not_eligible',
        );
        assert.equal(forums, 0);
        Object.assign(notion, { readPage: readEligible });
        await recordWorkObservation(db, { ...observation, editedAt: newer }, context.clock());
        const resumed = await claimWorkOperation(db, workScope, context.clock());
        assert.ok(resumed);
        assert.equal(resumed.id, operation.id);
        operation = resumed;
      }
      assert.equal(
        (await processWorkProvision(db, { notion, discord }, operation, context)).kind,
        'progress',
      );
      await recordWorkObservation(db, observation, context.clock());
      await processWorkRouteRequest(db, { notion, discord }, context);
      assert.equal(forums, 1);
      assert.equal(posts, 1);
      assert.match(JSON.stringify(overviewCard), new RegExp(projectId));
      assert.equal(postPins, 1);
      assert.equal(
        db.raw
          .prepare(
            "SELECT json_extract(data_json,'$.overviewPostPin') AS pin FROM discord_project_homes",
          )
          .get()?.pin,
        'pinned',
      );
      assert.equal(
        db.raw
          .prepare("SELECT count(*) AS n FROM discord_work_operations WHERE kind='backlink'")
          .get()?.n,
        1,
      );
      assert.equal(
        db.raw.prepare('SELECT state FROM discord_work_requests').get()?.state,
        'completed',
      );
      const showInput = {
        applicationId: '444444444444444444',
        guildId: workScope.guildId,
        discordUserId,
        channelId: threadId,
        interactionId: '777777777777777777',
        intent: { action: 'show' },
      };
      const waiting = await runWorkPreview(db, { notion, discord }, showInput, context);
      assert.match(JSON.stringify(waiting), /Notion link is waiting/);
      const blocks: Record<string, unknown>[] = [
        { id: 'organizer', type: 'paragraph', created_by: { id: 'person' } },
      ];
      Object.assign(notion, {
        readSelf: () => Promise.resolve({ id: 'bot', type: 'bot' }),
        listBlockChildren: () => Promise.resolve({ results: blocks, nextCursor: null }),
        appendBlockChildren: (pageId: string, children: Record<string, unknown>[]) => {
          assert.equal(pageId.replaceAll('-', ''), projectId.replaceAll('-', ''));
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
      const shown = await runWorkPreview(db, { notion, discord }, showInput, context);
      assert.match(JSON.stringify(shown), /Last Notion link write: confirmed/);
      assert.match(
        JSON.stringify(shown),
        new RegExp(`discord\\.com/channels/${workScope.guildId}/${threadId}`),
      );
      const conversationRow = db.raw.prepare('SELECT id FROM discord_work_conversations').get();
      assert.ok(conversationRow);
      const conversation = await readWorkConversation(db, workScope, String(conversationRow.id));
      assert.ok(conversation);
      let edits = 0,
        editedCard: unknown;
      Object.assign(discord, {
        editCard: (input: { card: unknown }) => {
          edits++;
          editedCard = input.card;
          return Promise.resolve();
        },
      });
      Object.assign(notion, {
        readPage: () =>
          Promise.resolve({
            ...project,
            properties: {
              ...project.properties,
              Name: { type: 'title', title: [{ plain_text: 'Renamed project' }] },
            },
          }),
      });
      assert.equal(
        (await refreshPlanningOverview(db, { notion, discord }, conversation, context)).kind,
        'progress',
      );
      assert.equal(edits, 1);
      assert.match(JSON.stringify(editedCard), /Renamed project/);
      assert.match(JSON.stringify(editedCard), /lvbt_work_create/);
      assert.equal(
        db.raw
          .prepare("SELECT json_extract(data_json,'$.title') AS title FROM discord_project_homes")
          .get()?.title,
        'Renamed project',
      );
      assert.equal(
        (await refreshPlanningOverview(db, { notion, discord }, conversation, context)).kind,
        'idle',
      );
      assert.equal(edits, 1);
      db.raw
        .prepare("UPDATE identities SET link_method='verified_email' WHERE id='identity'")
        .run();
      assert.equal(
        (await refreshPlanningOverview(db, { notion, discord }, conversation, context)).reason,
        'authority_changed',
      );
      assert.equal(edits, 1);
    } finally {
      db.raw.close();
    }
  });
}
