import assert from 'node:assert/strict';
import test from 'node:test';
import { readWorkRoute } from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { DiscordWorkClient } from '../src/discord-work-provider';
import {
  startWorkRouteApproval,
  confirmWorkRouteApproval,
} from '../src/discord-work-route-preview';
import { discordUserId, sourceId, workFixture, workNow, workScope } from './support/discord-work';

void test('administrator approval validates and saves a selected Notion field and forum-tag mapping', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let stages = ['Planning', 'Ready'];
  Object.assign(notion, {
    readDataSource: () =>
      Promise.resolve({
        object: 'data_source',
        id: sourceId,
        properties: {
          Status: { type: 'status', status: { options: [{ name: 'Planning' }] } },
          Stage: {
            id: 'stage-id',
            type: 'select',
            select: { options: stages.map((name) => ({ name })) },
          },
        },
      }),
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        isCategory: false,
        destination: { kind: 'forum', channelId: '333333333333333333', parentId: null },
        audienceFingerprint: 'audience',
        archived: false,
        locked: false,
        canRead: true,
        canSend: true,
        requiredTag: false,
        tags: [
          { id: '777777777777777777', name: 'Planning' },
          { id: '888888888888888888', name: 'Ready' },
        ],
      }),
  });
  const input = {
    id: 'route',
    expectedRevision: 0,
    sourceId,
    kind: 'event' as const,
    trigger: { property: 'Status', values: ['Planning'] },
    destinationId: '333333333333333333',
    tagSync: {
      property: 'stage-id',
      mappings: [
        { value: 'Planning', tagName: 'Planning' },
        { value: 'Ready', tagName: 'Ready' },
      ],
    },
  };
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    const first = await startWorkRouteApproval(
      db,
      { notion, discord },
      { scope: workScope, discordUserId: discordUserId, input: input, now: workNow },
    );
    assert.equal(first.kind, 'ready');
    stages = ['Planning'];
    assert.equal(
      (
        await confirmWorkRouteApproval(
          db,
          { notion, discord },
          {
            scope: workScope,
            discordUserId: discordUserId,
            receiptId: first.receiptId,
            now: workNow,
          },
        )
      ).kind,
      'unavailable',
    );
    assert.equal(await readWorkRoute(db, workScope, 'route'), null);
    stages = ['Planning', 'Ready'];
    const saved = await confirmWorkRouteApproval(
      db,
      { notion, discord },
      { scope: workScope, discordUserId: discordUserId, receiptId: first.receiptId, now: workNow },
    );
    assert.equal(saved.kind, 'saved');
    assert.deepEqual((await readWorkRoute(db, workScope, 'route'))?.tagSync, input.tagSync);
    const { tagSync: _mapping, ...editedInput } = input;
    const edit = await startWorkRouteApproval(
      db,
      { notion, discord },
      {
        scope: workScope,
        discordUserId: discordUserId,
        input: { ...editedInput, expectedRevision: 1 },
        now: workNow,
      },
    );
    assert.equal(edit.kind, 'ready');
    assert.equal(
      (
        await confirmWorkRouteApproval(
          db,
          { notion, discord },
          {
            scope: workScope,
            discordUserId: discordUserId,
            receiptId: edit.receiptId,
            now: workNow,
          },
        )
      ).kind,
      'unavailable',
    );
    assert.deepEqual((await readWorkRoute(db, workScope, 'route'))?.tagSync, input.tagSync);
  } finally {
    db.raw.close();
  }
});
