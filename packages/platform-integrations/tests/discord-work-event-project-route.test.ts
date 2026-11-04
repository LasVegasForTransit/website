import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveProjectHome,
  readProjectHome,
  setProjectEventForumTags,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { seedActiveWorkRoute } from '@lasvegasfortransit/platform-storage/test-db';
import {
  recordWorkObservation,
  retryHeldWorkRequests,
  retryPreflightTagFailures,
} from '@lasvegasfortransit/platform-storage/discord-work-requests';
import { claimWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { resolveWorkActor } from '../src/discord-work-authority';
import { processWorkRouteRequest } from '../src/discord-work-route-requests';
import { processWorkProvision } from '../src/discord-work-provision';
import {
  discordUserId,
  sourceId,
  projectId,
  projectSourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

function requiresForumTag(scenario: string): boolean {
  return ['required-tag', 'selected-tag', 'tag-changed'].includes(scenario);
}

for (const scenario of [
  'create',
  'changed',
  'required-tag',
  'selected-tag',
  'tag-changed',
  'tag-late',
  'adopt',
  'adopt-wrong-parent',
] as const) {
  void test(`event project route ${scenario === 'changed' ? 'holds changed relation' : scenario === 'required-tag' ? 'holds when the forum requires a tag' : 'creates a post in the matched forum'}`, async () => {
    const { db, notion } = workFixture();
    const discord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: '444444444444444444',
      botToken: 'fixture-only',
    });
    const categoryId = '333333333333333333',
      forumId = '555555555555555555',
      threadId = '666666666666666666',
      eventId = '20000000-0000-4000-8000-000000000002',
      eventSource = '20000000-0000-4000-8000-000000000001';
    let related = projectId,
      requiresTag = requiresForumTag(scenario),
      creates = 0,
      cards = 0;
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
                Project: { type: 'relation', relation: [{ id: related }], has_more: false },
              },
            }),
    });
    Object.assign(discord, {
      membership: () => Promise.resolve(true),
      inspectDestination: (id: string) =>
        Promise.resolve({
          isCategory: id === categoryId,
          privateThread: false,
          destination: {
            kind: id === threadId ? 'thread' : 'forum',
            channelId: id,
            parentId:
              id === categoryId
                ? null
                : id === threadId && scenario === 'adopt'
                  ? forumId
                  : categoryId,
          },
          audienceFingerprint: 'audience',
          canRead: true,
          canSend: true,
          canManageChannels: true,
          canCreateThreads: false,
          archived: false,
          locked: false,
          requiredTag: requiresTag && id === forumId,
          tags: [
            { id: '888888888888888888', name: 'Event' },
            { id: '999999999999999999', name: 'Meetup' },
          ],
        }),
      sendCard: (channelId: string) => {
        assert.equal(channelId, threadId);
        cards++;
        return Promise.resolve('777777777777777777');
      },
      createTaskConversation: (input: {
        destination: { destination: { channelId: string } };
        tagIds: string[];
      }) => {
        assert.equal(input.destination.destination.channelId, forumId);
        if (scenario === 'selected-tag' || scenario === 'tag-changed')
          assert.deepEqual(input.tagIds, [
            scenario === 'tag-changed' ? '999999999999999999' : '888888888888888888',
          ]);
        creates++;
        return Promise.resolve({ threadId, starterMessageId: threadId });
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
      await saveProjectHome(
        db,
        {
          id: 'project',
          scope: workScope,
          projectSourceId,
          projectId,
          destination: { kind: 'forum', channelId: forumId, parentId: categoryId },
          taskParent: null,
          audienceFingerprint: 'audience',
          approvedBy: actor.personId,
          state: 'active',
          generation: 1,
        },
        0,
        workNow,
      );
      if (scenario === 'selected-tag' || scenario === 'tag-changed') {
        const home = await readProjectHome(db, workScope, 'project');
        assert.ok(home);
        assert.equal(
          await setProjectEventForumTags(
            db,
            { personId: actor.personId },
            { home, tagIds: ['888888888888888888'] },
            workNow,
          ),
          true,
        );
      }
      const route = {
        id: 'route',
        scope: workScope,
        sourceId: eventSource,
        kind: 'event' as const,
        state: 'active' as const,
        revision: 1,
        trigger: { property: 'Status', values: ['Planning'] },
        destination: { kind: 'category' as const, channelId: categoryId },
        projectRelation: { property: 'Project', projectSourceId },
        approvedBy: actor.personId,
        approvedDiscordId: discordUserId,
        approvedGrantVersion: actor.grantVersion,
        audienceFingerprint: 'audience',
      };
      seedActiveWorkRoute(db, route, workNow);
      await recordWorkObservation(
        db,
        {
          scope: workScope,
          routeId: route.id,
          revision: 1,
          pageId: eventId,
          eligible: true,
          createdAt: new Date(workNow.getTime() + 1000),
          editedAt: new Date(workNow.getTime() + 1000),
        },
        context.clock(),
      );
      const requestResult = await processWorkRouteRequest(db, { notion, discord }, context);
      if (scenario === 'required-tag') {
        assert.deepEqual(requestResult, { kind: 'paused', reason: 'forum_tag_required' });
        assert.equal(creates, 0);
        assert.equal(await claimWorkOperation(db, workScope, context.clock()), null);
        requiresTag = false;
        assert.equal(
          await retryHeldWorkRequests(
            db,
            { personId: actor.personId },
            { scope: workScope, routeId: route.id, revision: 1 },
            context.clock(),
          ),
          true,
        );
        assert.equal(
          (await processWorkRouteRequest(db, { notion, discord }, context)).kind,
          'progress',
        );
        const resumed = await claimWorkOperation(db, workScope, context.clock());
        assert.ok(resumed);
        assert.equal(
          (await processWorkProvision(db, { notion, discord }, resumed, context)).kind,
          'progress',
        );
        assert.equal(creates, 1);
        return;
      }
      assert.equal(requestResult.kind, 'progress');
      const op = await claimWorkOperation(db, workScope, context.clock());
      assert.ok(op);
      if (scenario === 'adopt' || scenario === 'adopt-wrong-parent') {
        const payload = {
          ...(JSON.parse(op.payload_json) as Record<string, unknown>),
          adoptThreadId: threadId,
        };
        op.payload_json = JSON.stringify(payload);
        db.raw
          .prepare('UPDATE discord_work_operations SET payload_json=? WHERE id=?')
          .run(op.payload_json, op.id);
        const result = await processWorkProvision(db, { notion, discord }, op, context);
        assert.equal(result.kind, scenario === 'adopt' ? 'progress' : 'paused');
        assert.equal(creates, 0);
        assert.equal(cards, scenario === 'adopt' ? 1 : 0);
        if (scenario === 'adopt')
          assert.equal(
            db.raw
              .prepare(
                "SELECT thread_id FROM discord_work_conversations WHERE json_extract(data_json,'$.subject.kind')='event_plan'",
              )
              .get()?.thread_id,
            threadId,
          );
        return;
      }
      if (scenario === 'tag-late') {
        requiresTag = true;
        assert.deepEqual(await processWorkProvision(db, { notion, discord }, op, context), {
          kind: 'paused',
          reason: 'forum_tag_required',
        });
        assert.equal(creates, 0);
        db.raw.prepare("UPDATE discord_work_operations SET result_json='{}' WHERE id=?").run(op.id);
        assert.equal(
          await retryPreflightTagFailures(
            db,
            { personId: actor.personId },
            { scope: workScope, routeId: route.id, revision: 1 },
            context.clock(),
          ),
          false,
        );
        db.raw.prepare('UPDATE discord_work_operations SET result_json=NULL WHERE id=?').run(op.id);
        requiresTag = false;
        assert.equal(
          await retryPreflightTagFailures(
            db,
            { personId: actor.personId },
            { scope: workScope, routeId: route.id, revision: 1 },
            context.clock(),
          ),
          true,
        );
        const resumed = await claimWorkOperation(db, workScope, context.clock());
        assert.ok(resumed);
        assert.equal(
          (await processWorkProvision(db, { notion, discord }, resumed, context)).kind,
          'progress',
        );
        assert.equal(creates, 1);
        return;
      }
      if (scenario === 'tag-changed') {
        const home = await readProjectHome(db, workScope, 'project');
        assert.ok(home);
        assert.equal(
          await setProjectEventForumTags(
            db,
            { personId: actor.personId },
            { home, tagIds: ['999999999999999999'] },
            context.clock(),
          ),
          true,
        );
      }
      if (scenario === 'changed') related = '10000000-0000-4000-8000-000000000005';
      const result = await processWorkProvision(db, { notion, discord }, op, context);
      assert.equal(result.kind, scenario === 'changed' ? 'paused' : 'progress');
      assert.equal(creates, scenario === 'changed' ? 0 : 1);
    } finally {
      db.raw.close();
    }
  });
}
