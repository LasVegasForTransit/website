import assert from 'node:assert/strict';
import test from 'node:test';
import { seedActiveWorkRoute } from '@lasvegasfortransit/platform-storage/test-db';
import {
  saveProjectHome,
  saveWorkConversation,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  enqueueWorkOperation,
  claimWorkOperation,
  readWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { DiscordApiFailure } from '../src/discord-types';
import { resolveWorkActor } from '../src/discord-work-authority';
import { processWorkTagSync } from '../src/discord-work-tag-sync';
import { recoverOneWorkOperation } from '../src/discord-work-recovery';
import { runWorkPreview } from '../src/discord-work-setup';
import { verifyTagFollowup } from './support/discord-work-tag-followup';
import {
  discordUserId,
  projectId,
  projectSourceId,
  sourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

for (const mode of ['normal', 'lost', 'limited', 'changed'] as const) {
  void test(`a tag update preserves organizer tags (${mode})`, async () => {
    const { db, notion, project } = workFixture();
    const categoryId = '222222222222222223',
      forumId = '333333333333333333',
      threadId = '555555555555555555',
      humanTag = '777777777777777777',
      managedTag = '888888888888888888',
      organizerTag = '777777777777777778';
    const discord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: '444444444444444444',
      botToken: 'fixture-only',
    });
    let tags = [humanTag],
      writes = 0,
      attempts = 0;
    Object.assign(discord, {
      membership: () => Promise.resolve(true),
      inspectDestination: (id: string) =>
        Promise.resolve({
          isCategory: id === categoryId,
          destination: {
            kind: id === threadId ? 'thread' : 'forum',
            channelId: id,
            parentId: id === forumId ? categoryId : id === threadId ? forumId : null,
          },
          audienceFingerprint: 'audience',
          canRead: true,
          canSend: true,
          privateThread: false,
          locked: false,
          archived: false,
          requiredTag: false,
          tags: [
            { id: humanTag, name: 'Volunteer' },
            { id: managedTag, name: 'Ready' },
            { id: organizerTag, name: 'Organizing' },
          ],
        }),
      readForumTags: () => Promise.resolve(tags),
      updateForumTags: (input: { expectedTags: string[]; tags: string[] }) => {
        assert.deepEqual(input.expectedTags, tags);
        attempts++;
        if (mode === 'limited' && attempts === 1)
          return Promise.reject(new DiscordApiFailure('rate_limited', 1000));
        if (mode === 'changed' && attempts === 1) {
          tags = [...tags, organizerTag];
          return Promise.reject(new Error('forum_tags_changed'));
        }
        tags = input.tags;
        writes++;
        return mode === 'lost' ? Promise.reject(new Error('response lost')) : Promise.resolve();
      },
    });
    Object.assign(project.properties, {
      Stage: { id: 'stage-id', type: 'select', select: { name: 'Ready' } },
    });
    const home = {
      id: 'home',
      scope: workScope,
      projectSourceId,
      projectId,
      destination: { kind: 'forum' as const, channelId: forumId, parentId: categoryId },
      taskParent: null,
      audienceFingerprint: 'audience',
      approvedBy: 'guest',
      state: 'active' as const,
      generation: 1,
    };
    const conversation = {
      id: 'overview',
      scope: workScope,
      subject: { kind: 'project_plan' as const, sourceId: projectSourceId, pageId: projectId },
      homeId: home.id,
      placementProjectId: projectId,
      threadId,
      starterMessageId: threadId,
      mode: 'selected' as const,
      state: 'active' as const,
      generation: 1,
      activationId: threadId,
      cursorId: threadId,
      windowUpperId: null,
      windowBeforeId: null,
      footerBlockIds: [],
    };
    try {
      db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
      db.raw
        .prepare(
          "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
        )
        .run(workNow.toISOString());
      await saveProjectHome(db, home, 0, workNow);
      await saveWorkConversation(db, conversation, 0, workNow);
      seedActiveWorkRoute(
        db,
        {
          id: 'route',
          scope: workScope,
          sourceId: projectSourceId,
          kind: 'project',
          state: 'active',
          revision: 1,
          trigger: { property: 'Status', values: ['Ready'] },
          destination: { kind: 'category', channelId: categoryId },
          tagSync: { property: 'stage-id', mappings: [{ value: 'Ready', tagName: 'Ready' }] },
          approvedBy: 'guest',
          audienceFingerprint: 'audience',
        },
        workNow,
      );
      const actor = await resolveWorkActor(db, workScope, discordUserId);
      assert.ok(actor);
      await enqueueWorkOperation(
        db,
        {
          id: 'tags',
          scope: workScope,
          homeId: home.id,
          conversationId: conversation.id,
          generation: 1,
          kind: 'refresh',
          sourceKey: 'tags:one',
          actorPersonId: actor.personId,
          actorDiscordId: discordUserId,
          grantVersion: actor.grantVersion,
          originalAuthorId: discordUserId,
          payload: { intent: 'tag-sync', routeId: 'route', routeRevision: 1 },
        },
        workNow,
      );
      const op = await claimWorkOperation(db, workScope, workNow);
      assert.ok(op);
      let clock = workNow;
      const result = await processWorkTagSync(db, { notion, discord }, op, {
        scope: workScope,
        taskSourceId: sourceId,
        enabled: true,
        clock: () => clock,
      });
      assert.equal(result.kind, mode === 'normal' ? 'progress' : 'paused');
      if (mode === 'changed') {
        const failed = await readWorkOperation(db, workScope, op.id);
        assert.equal(failed?.state, 'failed');
        assert.ok(failed.result_json);
        const context = {
          scope: workScope,
          taskSourceId: sourceId,
          enabled: true,
          clock: () => clock,
        };
        const base = {
          applicationId: '444444444444444444',
          guildId: workScope.guildId,
          discordUserId,
          channelId: forumId,
          interactionId: '999999999999999997',
        };
        await runWorkPreview(
          db,
          { notion, discord },
          { ...base, intent: { action: 'routes' } },
          context,
        );
        const list = db.raw
          .prepare(
            "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-list' ORDER BY rowid DESC LIMIT 1",
          )
          .get();
        assert.ok(list);
        const management = await runWorkPreview(
          db,
          { notion, discord },
          {
            ...base,
            intent: { action: 'route-manage', linkId: String(list.id), value: 'route' },
          },
          context,
        );
        assert.match(JSON.stringify(management), /Retry checks/);
        assert.match(JSON.stringify(management), /Review the forum post tags/);
        const control = db.raw
          .prepare(
            "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-manage' ORDER BY rowid DESC LIMIT 1",
          )
          .get();
        assert.ok(control);
        const retry = await runWorkPreview(
          db,
          { notion, discord },
          {
            ...base,
            intent: { action: 'route-retry-checks', linkId: String(control.id) },
          },
          context,
        );
        assert.match(JSON.stringify(retry), /Checks queued/);
        assert.equal((await readWorkOperation(db, workScope, op.id))?.result_json, null);
        const resumed = await claimWorkOperation(db, workScope, clock);
        assert.ok(resumed);
        assert.equal(
          (
            await processWorkTagSync(db, { notion, discord }, resumed, {
              scope: workScope,
              taskSourceId: sourceId,
              enabled: true,
              clock: () => clock,
            })
          ).kind,
          'progress',
        );
        assert.equal(attempts, 2);
      }
      if (mode === 'limited') {
        assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'retryable');
        assert.equal((await readWorkOperation(db, workScope, op.id))?.result_json, null);
        clock = new Date(workNow.getTime() + 1001);
        const resumed = await claimWorkOperation(db, workScope, clock);
        assert.ok(resumed);
        assert.equal(
          (
            await processWorkTagSync(db, { notion, discord }, resumed, {
              scope: workScope,
              taskSourceId: sourceId,
              enabled: true,
              clock: () => clock,
            })
          ).kind,
          'progress',
        );
        assert.equal(attempts, 2);
      }
      if (mode === 'lost') {
        assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'held');
        clock = new Date(workNow.getTime() + 60_001);
        const context = {
          scope: workScope,
          taskSourceId: sourceId,
          enabled: true,
          clock: () => clock,
        };
        tags = [humanTag];
        assert.equal(
          (await recoverOneWorkOperation(db, { notion, discord }, context)).kind,
          'paused',
        );
        assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'held');
        assert.equal(writes, 1);
        tags = [humanTag, managedTag];
        clock = new Date(clock.getTime() + 300_001);
        assert.equal(
          (await recoverOneWorkOperation(db, { notion, discord }, context)).kind,
          'progress',
        );
        const resumed = await claimWorkOperation(db, workScope, clock);
        assert.ok(resumed);
        assert.equal(
          (await processWorkTagSync(db, { notion, discord }, resumed, context)).kind,
          'progress',
        );
      }
      assert.deepEqual(
        tags,
        mode === 'changed' ? [humanTag, organizerTag, managedTag] : [humanTag, managedTag],
      );
      assert.equal(writes, 1);
      assert.deepEqual(
        (await readWorkConversation(db, workScope, conversation.id))?.managedForumTags,
        { routeId: 'route', tagIds: [managedTag] },
      );
      assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'confirmed');
      await verifyTagFollowup({
        db,
        notion,
        project,
        discord,
        actor,
        conversation,
        homeId: home.id,
        categoryId,
        forumId,
        writes,
      });
    } finally {
      db.raw.close();
    }
  });
}
