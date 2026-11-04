import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordWorkClient } from '../src/discord-work-provider';
import {
  previewWorkRoute,
  startWorkRouteApproval,
  confirmWorkRouteApproval,
  projectRouteSourceMatches,
} from '../src/discord-work-route-preview';
import { readWorkRoute } from '@lasvegasfortransit/platform-storage/discord-work-routes';
import {
  discordUserId,
  projectSourceId,
  sourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('project routes require the projects source configured for this workspace and server', async () => {
  const { db } = workFixture();
  try {
    assert.equal(await projectRouteSourceMatches(db, workScope, sourceId, projectSourceId), true);
    assert.equal(await projectRouteSourceMatches(db, workScope, sourceId, sourceId), false);
    assert.equal(
      await projectRouteSourceMatches(
        db,
        { ...workScope, guildId: '999999999999999999' },
        sourceId,
        projectSourceId,
      ),
      false,
    );
  } finally {
    db.raw.close();
  }
});

void test('route preview validates live source options and destination before an administrator can approve it', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let reads = 0;
  Object.assign(notion, {
    readDataSource: () => {
      reads++;
      return Promise.resolve({
        object: 'data_source',
        id: sourceId,
        properties: { Status: { type: 'status', status: { options: [{ name: 'Planning' }] } } },
      });
    },
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        isCategory: false,
        destination: { kind: 'text', channelId: '333333333333333333', parentId: null },
        audienceFingerprint: 'audience',
        archived: false,
        locked: false,
        canRead: true,
        canSend: true,
        canCreateThreads: true,
        canManageChannels: false,
        requiredTag: false,
        tags: [],
      }),
  });
  const input = {
    sourceId,
    kind: 'event' as const,
    trigger: { property: 'Status', values: ['Planning'] },
    destinationId: '333333333333333333',
  };
  try {
    assert.deepEqual(
      await previewWorkRoute(
        db,
        { notion, discord },
        { scope: workScope, discordUserId: discordUserId, input: input },
      ),
      { kind: 'unavailable', reason: 'administrator_required' },
    );
    assert.equal(reads, 0);
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    const ready = await previewWorkRoute(
      db,
      { notion, discord },
      { scope: workScope, discordUserId: discordUserId, input: input },
    );
    assert.equal(ready.kind, 'ready');
    assert.equal(ready.destination.kind, 'text');
    assert.equal(ready.audienceFingerprint, 'audience');
    const draft = await startWorkRouteApproval(
      db,
      { notion, discord },
      {
        scope: workScope,
        discordUserId: discordUserId,
        input: { ...input, id: 'route', expectedRevision: 0 },
        now: workNow,
      },
    );
    assert.equal(draft.kind, 'ready');
    assert.equal(await readWorkRoute(db, workScope, 'route'), null);
    const originalInspection = discord.inspectDestination.bind(discord);
    Object.assign(discord, {
      inspectDestination: async () => ({
        ...(await originalInspection(input.destinationId)),
        audienceFingerprint: 'changed',
      }),
    });
    assert.deepEqual(
      await confirmWorkRouteApproval(
        db,
        { notion, discord },
        {
          scope: workScope,
          discordUserId: discordUserId,
          receiptId: draft.receiptId,
          now: workNow,
        },
      ),
      { kind: 'unavailable', reason: 'preview_changed' },
    );
    assert.equal(await readWorkRoute(db, workScope, 'route'), null);
    Object.assign(discord, { inspectDestination: originalInspection });
    Object.assign(discord, { membership: () => Promise.resolve(false) });
    assert.deepEqual(
      await confirmWorkRouteApproval(
        db,
        { notion, discord },
        {
          scope: workScope,
          discordUserId: discordUserId,
          receiptId: draft.receiptId,
          now: workNow,
        },
      ),
      { kind: 'unavailable', reason: 'administrator_required' },
    );
    assert.equal(await readWorkRoute(db, workScope, 'route'), null);
    Object.assign(discord, { membership: () => Promise.resolve(true) });
    assert.deepEqual(
      await confirmWorkRouteApproval(
        db,
        { notion, discord },
        {
          scope: workScope,
          discordUserId: discordUserId,
          receiptId: draft.receiptId,
          now: workNow,
        },
      ),
      { kind: 'saved' },
    );
    assert.equal((await readWorkRoute(db, workScope, 'route'))?.state, 'paused');
    assert.deepEqual(
      await confirmWorkRouteApproval(
        db,
        { notion, discord },
        {
          scope: workScope,
          discordUserId: discordUserId,
          receiptId: draft.receiptId,
          now: workNow,
        },
      ),
      { kind: 'unavailable', reason: 'preview_expired' },
    );
    assert.deepEqual(
      await previewWorkRoute(
        db,
        { notion, discord },
        {
          scope: workScope,
          discordUserId: discordUserId,
          input: {
            ...input,
            trigger: { property: 'Status', values: ['Imaginary'] },
          },
        },
      ),
      { kind: 'unavailable', reason: 'trigger_option_unavailable' },
    );
    const originalText = discord.inspectDestination.bind(discord);
    Object.assign(discord, {
      inspectDestination: async () => ({
        ...(await originalText(input.destinationId)),
        canCreateThreads: false,
      }),
    });
    assert.deepEqual(
      await previewWorkRoute(
        db,
        { notion, discord },
        { scope: workScope, discordUserId: discordUserId, input: input },
      ),
      { kind: 'unavailable', reason: 'thread_permission_required' },
    );
    Object.assign(discord, {
      inspectDestination: () =>
        Promise.resolve({
          isCategory: false,
          destination: { kind: 'forum', channelId: input.destinationId, parentId: null },
          audienceFingerprint: 'audience',
          archived: false,
          locked: false,
          canRead: true,
          canSend: true,
          canCreateThreads: false,
          canManageChannels: false,
          requiredTag: true,
          tags: [{ id: 'tag-1', name: 'Events' }],
        }),
    });
    const forumInput = { ...input, id: 'route', expectedRevision: 1 };
    assert.deepEqual(
      await startWorkRouteApproval(
        db,
        { notion, discord },
        { scope: workScope, discordUserId: discordUserId, input: forumInput, now: workNow },
      ),
      { kind: 'unavailable', reason: 'tag_selection_required' },
    );
    assert.deepEqual(
      await startWorkRouteApproval(
        db,
        { notion, discord },
        {
          scope: workScope,
          discordUserId: discordUserId,
          input: { ...forumInput, tagIds: ['wrong'] },
          now: workNow,
        },
      ),
      { kind: 'unavailable', reason: 'invalid_forum_tag' },
    );
    const tagged = await startWorkRouteApproval(
      db,
      { notion, discord },
      {
        scope: workScope,
        discordUserId: discordUserId,
        input: { ...forumInput, tagIds: ['tag-1'] },
        now: workNow,
      },
    );
    assert.equal(tagged.kind, 'ready');
    const taggedInspection = discord.inspectDestination.bind(discord);
    Object.assign(discord, {
      inspectDestination: async () => ({
        ...(await taggedInspection(input.destinationId)),
        tags: [],
      }),
    });
    assert.deepEqual(
      await confirmWorkRouteApproval(
        db,
        { notion, discord },
        {
          scope: workScope,
          discordUserId: discordUserId,
          receiptId: tagged.receiptId,
          now: workNow,
        },
      ),
      { kind: 'unavailable', reason: 'required_tag_unavailable' },
    );
    assert.equal((await readWorkRoute(db, workScope, 'route'))?.revision, 1);
    Object.assign(discord, { inspectDestination: taggedInspection });
    assert.deepEqual(
      await confirmWorkRouteApproval(
        db,
        { notion, discord },
        {
          scope: workScope,
          discordUserId: discordUserId,
          receiptId: tagged.receiptId,
          now: workNow,
        },
      ),
      { kind: 'saved' },
    );
    assert.deepEqual((await readWorkRoute(db, workScope, 'route'))?.tagIds, ['tag-1']);
    const category = {
      isCategory: true,
      destination: { kind: 'forum', channelId: input.destinationId, parentId: null },
      audienceFingerprint: 'audience',
      archived: false,
      locked: false,
      canRead: true,
      canSend: false,
      canCreateThreads: false,
      canManageChannels: true,
      requiredTag: false,
      tags: [],
    };
    Object.assign(discord, {
      inspectDestination: () => Promise.resolve(category),
      communityEnabled: () => Promise.resolve(false),
    });
    assert.deepEqual(
      await previewWorkRoute(
        db,
        { notion, discord },
        {
          scope: workScope,
          discordUserId: discordUserId,
          input: {
            ...input,
            kind: 'project',
          },
        },
      ),
      { kind: 'unavailable', reason: 'forum_unavailable' },
    );
    Object.assign(discord, { communityEnabled: () => Promise.resolve(true) });
    assert.equal(
      (
        await previewWorkRoute(
          db,
          { notion, discord },
          {
            scope: workScope,
            discordUserId: discordUserId,
            input: {
              ...input,
              kind: 'project',
            },
          },
        )
      ).kind,
      'ready',
    );
    assert.deepEqual(
      await previewWorkRoute(
        db,
        { notion, discord },
        { scope: workScope, discordUserId: discordUserId, input: input },
      ),
      { kind: 'unavailable', reason: 'event_channel_required' },
    );
  } finally {
    db.raw.close();
  }
});
