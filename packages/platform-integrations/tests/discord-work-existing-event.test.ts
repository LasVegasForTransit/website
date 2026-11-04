import assert from 'node:assert/strict';
import test from 'node:test';
import { seedActiveWorkRoute } from '@lasvegasfortransit/platform-storage/test-db';
import { claimWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { runWorkPreview } from '../src/discord-work-setup';
import { resolveWorkActor } from '../src/discord-work-authority';
import { processWorkRouteRequest } from '../src/discord-work-route-requests';
import { processWorkProvision } from '../src/discord-work-provision';
import { processWorkAction } from '../src/discord-work-actions';
import { discordUserId, sourceId, workFixture, workNow, workScope } from './support/discord-work';

void test('an existing eligible event reuses a unique post and holds uncertain matches', async () => {
  const { db, notion } = workFixture();
  const eventSource = '20000000-0000-4000-8000-000000000001';
  const eventId = '20000000-0000-4000-8000-000000000002';
  const forumId = '333333333333333333';
  const threadId = '555555555555555555';
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let match: string | null = null;
  let archived = false;
  Object.assign(notion, {
    readPage: () =>
      Promise.resolve({
        object: 'page',
        id: eventId,
        parent: { data_source_id: eventSource },
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Event' }] },
          Status: { type: 'status', status: { name: 'Planning' } },
        },
      }),
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    findLinkedEvent: () => Promise.resolve(match),
    inspectDestination: (id: string) =>
      Promise.resolve({
        destination: {
          kind: id === threadId ? 'thread' : 'forum',
          channelId: id,
          parentId: id === threadId ? forumId : null,
        },
        privateThread: false,
        audienceFingerprint: 'audience',
        archived: id === threadId && archived,
        locked: false,
        canRead: true,
        canSend: true,
        canCreateThreads: false,
        canManageChannels: false,
        requiredTag: false,
        tags: [],
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
      id: 'event-route',
      scope: workScope,
      sourceId: eventSource,
      kind: 'event' as const,
      state: 'active' as const,
      revision: 1,
      trigger: { property: 'Status', values: ['Planning'] },
      destination: { kind: 'forum' as const, channelId: forumId },
      approvedBy: actor.personId,
      approvedDiscordId: discordUserId,
      approvedGrantVersion: actor.grantVersion,
      audienceFingerprint: 'audience',
    };
    seedActiveWorkRoute(db, route, workNow);
    db.raw
      .prepare(
        "INSERT INTO discord_work_requests(id,scope_key,source_id,page_id,route_id,route_revision,state,created_at,existing_event) VALUES(?,?,?,?,?,1,'pending',?,1)",
      )
      .run(
        'existing-one',
        JSON.stringify([workScope.environment, workScope.guildId, workScope.workspaceId]),
        eventSource.replaceAll('-', ''),
        eventId.replaceAll('-', ''),
        route.id,
        workNow.toISOString(),
      );
    assert.deepEqual(await processWorkRouteRequest(db, { notion, discord }, context), {
      kind: 'paused',
      reason: 'existing_event_review',
    });
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM discord_work_operations WHERE kind='provision'")
        .get()?.n,
      0,
    );
    db.raw
      .prepare(
        "UPDATE discord_work_requests SET state='pending',reason=NULL WHERE id='existing-one'",
      )
      .run();
    match = threadId;
    archived = true;
    assert.deepEqual(await processWorkRouteRequest(db, { notion, discord }, context), {
      kind: 'paused',
      reason: 'existing_event_unavailable',
    });
    assert.equal(
      db.raw.prepare("SELECT reason FROM discord_work_requests WHERE id='existing-one'").get()
        ?.reason,
      'existing_event_unavailable',
    );
    db.raw
      .prepare(
        "UPDATE discord_work_requests SET state='pending',reason=NULL WHERE id='existing-one'",
      )
      .run();
    archived = false;
    assert.equal(
      (await processWorkRouteRequest(db, { notion, discord }, context)).kind,
      'progress',
    );
    const op = await claimWorkOperation(db, workScope, context.clock());
    assert.ok(op);
    assert.equal(
      (JSON.parse(op.payload_json) as { adoptThreadId: string }).adoptThreadId,
      threadId,
    );
    let cards = 0;
    Object.assign(discord, {
      sendCard: (id: string) => {
        assert.equal(id, threadId);
        cards++;
        return Promise.resolve('777777777777777777');
      },
      createTaskConversation: () => {
        throw new Error('must reuse the existing post');
      },
    });
    const blocks: Record<string, unknown>[] = [];
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
    assert.equal(
      (await processWorkProvision(db, { notion, discord }, op, context)).kind,
      'progress',
    );
    const backlink = await claimWorkOperation(db, workScope, context.clock());
    assert.ok(backlink);
    assert.equal(
      (await processWorkAction(db, { notion, discord }, backlink, context)).kind,
      'progress',
    );
    assert.equal(cards, 1);
    assert.deepEqual(
      blocks.map((block) => block.type),
      ['divider', 'paragraph'],
    );
    assert.match(
      JSON.stringify(blocks[1]),
      new RegExp(`discord\\.com/channels/${workScope.guildId}/${threadId}`),
    );
  } finally {
    db.raw.close();
  }
});

void test('an administrator can create a missing post for a held existing event once', async () => {
  const { db, notion } = workFixture();
  const eventSource = '20000000-0000-4000-8000-000000000001';
  const eventId = '20000000-0000-4000-8000-000000000002';
  const forumId = '333333333333333333';
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(notion, {
    readPage: () =>
      Promise.resolve({
        object: 'page',
        id: eventId,
        parent: { data_source_id: eventSource },
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Community event' }] },
          Status: { type: 'status', status: { name: 'Planning' } },
        },
      }),
  });
  let member = true;
  let creates = 0;
  const threadId = '555555555555555555';
  Object.assign(discord, {
    membership: () => Promise.resolve(member),
    createTaskConversation: () => {
      creates++;
      return Promise.resolve({ threadId, starterMessageId: threadId, cardChannelId: forumId });
    },
    inspectDestination: (id: string) =>
      Promise.resolve({
        destination: {
          kind: id === threadId ? 'thread' : 'forum',
          channelId: id,
          parentId: id === threadId ? forumId : null,
        },
        audienceFingerprint: 'audience',
        archived: false,
        locked: false,
        canRead: true,
        canSend: true,
        canCreateThreads: false,
        canManageChannels: false,
        requiredTag: false,
        tags: [],
      }),
  });
  const context = {
    scope: workScope,
    taskSourceId: sourceId,
    enabled: true,
    clock: () => new Date(workNow.getTime() + 120_000),
  };
  const base = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: forumId,
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
    const route = {
      id: 'event-route',
      scope: workScope,
      sourceId: eventSource,
      sourceTitle: 'Events',
      kind: 'event' as const,
      state: 'active' as const,
      revision: 1,
      trigger: { property: 'Status', values: ['Planning'] },
      destination: { kind: 'forum' as const, channelId: forumId },
      approvedBy: actor.personId,
      approvedDiscordId: discordUserId,
      approvedGrantVersion: actor.grantVersion,
      audienceFingerprint: 'audience',
    };
    seedActiveWorkRoute(db, route, workNow);
    db.raw
      .prepare(
        "INSERT INTO discord_work_requests(id,scope_key,source_id,page_id,route_id,route_revision,state,reason,created_at,existing_event) VALUES(?,?,?,?,?,1,'held','existing_event_review',?,1)",
      )
      .run(
        'existing-one',
        JSON.stringify([workScope.environment, workScope.guildId, workScope.workspaceId]),
        eventSource.replaceAll('-', ''),
        eventId.replaceAll('-', ''),
        route.id,
        workNow.toISOString(),
      );
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
    const card = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-manage', linkId: String(list.id), value: route.id } },
      context,
    );
    assert.match(JSON.stringify(card), /Community event/);
    assert.match(JSON.stringify(card), /Create a missing event post/);
    const manager = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-manage' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    assert.ok(manager);
    const create = {
      ...base,
      intent: { action: 'route-create-event', linkId: String(manager.id), value: 'existing-one' },
    };
    member = false;
    assert.match(
      JSON.stringify(await runWorkPreview(db, { notion, discord }, create, context)),
      /unavailable|cannot be created/,
    );
    member = true;
    assert.match(
      JSON.stringify(await runWorkPreview(db, { notion, discord }, create, context)),
      /post is being created/,
    );
    const op = await claimWorkOperation(db, workScope, context.clock());
    assert.ok(op);
    assert.equal(
      (JSON.parse(op.payload_json) as { adoptThreadId?: string }).adoptThreadId,
      undefined,
    );
    assert.match(
      JSON.stringify(await runWorkPreview(db, { notion, discord }, create, context)),
      /could not be created/,
    );
    assert.equal(
      db.raw
        .prepare(
          "SELECT count(*) AS n FROM discord_work_operations WHERE source_key='route-request:existing-one'",
        )
        .get()?.n,
      1,
    );
    const blocks: Record<string, unknown>[] = [];
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
    assert.equal(
      (await processWorkProvision(db, { notion, discord }, op, context)).kind,
      'progress',
    );
    const backlink = await claimWorkOperation(db, workScope, context.clock());
    assert.ok(backlink);
    assert.equal(
      (await processWorkAction(db, { notion, discord }, backlink, context)).kind,
      'progress',
    );
    assert.equal(creates, 1);
    assert.deepEqual(
      blocks.map((block) => block.type),
      ['divider', 'paragraph'],
    );
    assert.match(
      JSON.stringify(blocks[1]),
      new RegExp(`discord\\.com/channels/${workScope.guildId}/${threadId}`),
    );
  } finally {
    db.raw.close();
  }
});
