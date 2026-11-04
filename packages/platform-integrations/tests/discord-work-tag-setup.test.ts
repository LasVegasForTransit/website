import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveWorkRoute,
  readWorkRoute,
} from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { resolveWorkActor } from '../src/discord-work-authority';
import { setupReceipt } from '../src/discord-work-setup-common';
import { tagMappingSetup } from '../src/discord-work-tag-setup';
import { discordUserId, sourceId, workFixture, workNow, workScope } from './support/discord-work';

void test('an administrator maps each Notion value to a selected forum tag and reviews before saving', async () => {
  const { db, notion } = workFixture();
  const forumId = '333333333333333333',
    firstTag = '777777777777777777',
    secondTag = '888888888888888888';
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(notion, {
    readDataSource: () =>
      Promise.resolve({
        object: 'data_source',
        id: sourceId,
        properties: {
          Stage: { type: 'select', select: { options: [{ name: 'Planning' }, { name: 'Ready' }] } },
          Status: { type: 'status', status: { options: [{ name: 'Planning' }] } },
        },
      }),
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        isCategory: false,
        destination: { kind: 'forum', channelId: forumId, parentId: null },
        audienceFingerprint: 'audience',
        archived: false,
        locked: false,
        canRead: true,
        canSend: true,
        canCreateThreads: true,
        canManageChannels: true,
        requiredTag: false,
        tags: [
          { id: firstTag, name: 'In progress' },
          { id: secondTag, name: 'Ready' },
        ],
      }),
  });
  const base = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: forumId,
    interactionId: '777777777777777777',
    intent: { action: 'route-tags-start' },
  };
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
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
      sourceId,
      kind: 'event' as const,
      state: 'paused' as const,
      revision: 1,
      trigger: { property: 'Status', values: ['Planning'] },
      destination: { kind: 'forum' as const, channelId: forumId },
      approvedBy: 'guest',
      audienceFingerprint: 'audience',
    };
    assert.equal(await saveWorkRoute(db, actor, { route: route, expected: 0 }, workNow), true);
    const receipt = await setupReceipt(
      db,
      { request: base, actor, payload: { intent: 'route-manage', routeId: route.id, revision: 1 } },
      context,
    );
    const start = await tagMappingSetup(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-tags-start', linkId: receipt.id } },
      context,
    );
    assert.match(JSON.stringify(start), /Choose a Notion field/);
    const setup = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='tag-setup'",
      )
      .get();
    assert.ok(setup);
    const control = String(setup.id);
    const field = await tagMappingSetup(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-tags-field', linkId: control, value: 'Stage' } },
      context,
    );
    assert.match(JSON.stringify(field), /Planning/);
    const next = await tagMappingSetup(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-tags-value', linkId: control, value: firstTag } },
      context,
    );
    assert.match(JSON.stringify(next), /Ready/);
    const review = await tagMappingSetup(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-tags-value', linkId: control, value: secondTag } },
      context,
    );
    assert.match(JSON.stringify(review), /Planning.*In progress/s);
    assert.equal((await readWorkRoute(db, workScope, route.id))?.tagSync, undefined);
    const saved = await tagMappingSetup(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-tags-save', linkId: control } },
      context,
    );
    assert.match(JSON.stringify(saved), /saved/i);
    assert.deepEqual((await readWorkRoute(db, workScope, route.id))?.tagSync, {
      property: 'Stage',
      mappings: [
        { value: 'Planning', tagName: 'In progress' },
        { value: 'Ready', tagName: 'Ready' },
      ],
    });
  } finally {
    db.raw.close();
  }
});

void test('project routes require an example forum in the approved category', async () => {
  const { db, notion } = workFixture();
  const categoryId = '333333333333333333',
    forumId = '555555555555555555';
  let parentId = '999999999999999999';
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(notion, {
    readDataSource: () =>
      Promise.resolve({
        object: 'data_source',
        id: sourceId,
        properties: { Stage: { type: 'select', select: { options: [{ name: 'Ready' }] } } },
      }),
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        destination: { kind: 'forum', channelId: forumId, parentId },
        audienceFingerprint: 'audience',
        archived: false,
        locked: false,
        canRead: true,
        canSend: true,
        tags: [{ id: '777777777777777777', name: 'Ready' }],
      }),
  });
  const base = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: categoryId,
    interactionId: '777777777777777777',
    intent: { action: 'route-tags-start' },
  };
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
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
      id: 'project-route',
      scope: workScope,
      sourceId,
      kind: 'project' as const,
      state: 'paused' as const,
      revision: 1,
      trigger: { property: 'Stage', values: ['Ready'] },
      destination: { kind: 'category' as const, channelId: categoryId },
      approvedBy: 'guest',
      audienceFingerprint: 'audience',
    };
    assert.equal(await saveWorkRoute(db, actor, { route: route, expected: 0 }, workNow), true);
    const receipt = await setupReceipt(
      db,
      { request: base, actor, payload: { intent: 'route-manage', routeId: route.id, revision: 1 } },
      context,
    );
    const start = await tagMappingSetup(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-tags-start', linkId: receipt.id } },
      context,
    );
    assert.match(JSON.stringify(start), /Choose a project forum/);
    const setup = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='tag-setup'",
      )
      .get();
    assert.ok(setup);
    const wrong = await tagMappingSetup(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-tags-forum', linkId: String(setup.id), value: forumId } },
      context,
    );
    assert.match(JSON.stringify(wrong), /changed/);
    parentId = categoryId;
    const accepted = await tagMappingSetup(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-tags-forum', linkId: String(setup.id), value: forumId } },
      context,
    );
    assert.match(JSON.stringify(accepted), /Choose a Notion field/);
  } finally {
    db.raw.close();
  }
});
