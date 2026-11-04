import { seedActiveWorkRoute } from '@lasvegasfortransit/platform-storage/test-db';
import assert from 'node:assert/strict';
import test from 'node:test';
import { saveWorkRoute } from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { recordWorkObservation } from '@lasvegasfortransit/platform-storage/discord-work-requests';
import {
  claimWorkOperation,
  enqueueWorkOperation,
  readWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { resolveWorkActor } from '../src/discord-work-authority';
import { processWorkRouteRequest } from '../src/discord-work-route-requests';
import { processWorkProvision } from '../src/discord-work-provision';
import { recoverOneWorkOperation } from '../src/discord-work-recovery';
import { runWorkPreview } from '../src/discord-work-setup';
import { NotionTaskApiError } from '../src/notion-task-client';
import {
  discordUserId,
  projectId,
  projectSourceId,
  sourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('project requests queue one forum operation and a paused route fences provider writes', async () => {
  const { db, notion, project } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let creates = 0;
  const category = {
    isCategory: true,
    destination: { kind: 'forum', channelId: '333333333333333333', parentId: null },
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
    membership: () => Promise.resolve(true),
    inspectDestination: () => Promise.resolve(category),
    createProjectForum: () => {
      creates++;
      throw new Error('unexpected write');
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
  let current = workNow.getTime() + 120_000;
  const context = {
    scope: workScope,
    taskSourceId: sourceId,
    enabled: true,
    clock: () => new Date(current),
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
      destination: { kind: 'category' as const, channelId: category.destination.channelId },
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
        pageId: projectId,
        eligible: true,
        createdAt: new Date(workNow.getTime() + 1000),
        editedAt: new Date(workNow.getTime() + 1000),
      },
      context.clock(),
    );
    const readPage = notion.readPage.bind(notion);
    Object.assign(notion, {
      readPage: () => Promise.reject(new NotionTaskApiError('http_429', 120_000, true)),
    });
    assert.deepEqual(await processWorkRouteRequest(db, { notion, discord }, context), {
      kind: 'paused',
      reason: 'http_429',
    });
    assert.equal((await processWorkRouteRequest(db, { notion, discord }, context)).kind, 'idle');
    current += 120_001;
    Object.assign(notion, { readPage });
    assert.deepEqual(await processWorkRouteRequest(db, { notion, discord }, context), {
      kind: 'progress',
    });
    assert.equal((await processWorkRouteRequest(db, { notion, discord }, context)).kind, 'idle');
    const op = await claimWorkOperation(db, workScope, context.clock());
    assert.ok(op);
    await saveWorkRoute(
      db,
      { personId: actor.personId },
      { route: { ...route, revision: 2, state: 'paused' }, expected: 1 },
      context.clock(),
    );
    await processWorkProvision(db, { notion, discord }, op, context);
    assert.equal(creates, 0);
    await processWorkRouteRequest(db, { notion, discord }, context);
    assert.equal(
      db.raw.prepare('SELECT state FROM discord_work_requests').get()?.state,
      'superseded',
    );
    seedActiveWorkRoute(db, { ...route, revision: 3 }, context.clock());
    Object.assign(notion, {
      readPage: () =>
        Promise.resolve({
          ...project,
          last_edited_time: '2026-10-22T12:01:00.000Z',
          properties: {
            ...project.properties,
            Status: { type: 'status', status: { name: 'Done' } },
          },
        }),
    });
    await enqueueWorkOperation(
      db,
      {
        id: 'stale-status',
        scope: workScope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'stale-status',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: {
          intent: 'home',
          linkId: 'new-home',
          subject: { kind: 'project_plan', sourceId: projectSourceId, pageId: projectId },
          title: 'Project',
          destinationId: category.destination.channelId,
          audienceFingerprint: 'audience',
          createForum: true,
          routeId: route.id,
          routeRevision: 3,
        },
      },
      context.clock(),
    );
    const stale = await claimWorkOperation(db, workScope, context.clock());
    assert.ok(stale);
    await processWorkProvision(db, { notion, discord }, stale, context);
    assert.equal(creates, 0);
    assert.equal((await readWorkOperation(db, workScope, stale.id))?.reason, 'not_eligible');
    const stopped = await readWorkOperation(db, workScope, stale.id);
    assert.ok(stopped);
    assert.equal(
      (JSON.parse(stopped.payload_json) as { ineligibleEditedAt?: string }).ineligibleEditedAt,
      '2026-10-22T12:01:00.000Z',
    );
    await enqueueWorkOperation(
      db,
      {
        id: 'partial-creation',
        scope: workScope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'route-request:partial-request',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: JSON.parse(stopped.payload_json) as Record<string, unknown>,
      },
      context.clock(),
    );
    db.raw
      .prepare("UPDATE discord_work_operations SET result_json=? WHERE id='partial-creation'")
      .run(JSON.stringify({ forumId: '666666666666666666' }));
    const partial = await claimWorkOperation(db, workScope, context.clock());
    assert.ok(partial);
    assert.equal(
      (await processWorkProvision(db, { notion, discord }, partial, context)).reason,
      'eligibility_changed_after_effect',
    );
    const held = await readWorkOperation(db, workScope, partial.id);
    assert.equal(held?.state, 'held');
    assert.equal(
      (JSON.parse(held.result_json ?? '{}') as { forumId?: string }).forumId,
      '666666666666666666',
    );
    const later = { ...context, clock: () => new Date(context.clock().getTime() + 61_000) };
    assert.equal((await recoverOneWorkOperation(db, { notion, discord }, later)).kind, 'idle');
    assert.equal((await readWorkOperation(db, workScope, partial.id))?.state, 'held');
    db.raw
      .prepare(
        "INSERT INTO discord_work_requests(id,scope_key,source_id,page_id,route_id,route_revision,state,operation_id,created_at) SELECT 'partial-request',scope_key,source_id,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',id,revision,'held','partial-creation',? FROM discord_work_routes WHERE id='route'",
      )
      .run(context.clock().toISOString());
    const base = {
      applicationId: '444444444444444444',
      guildId: workScope.guildId,
      discordUserId,
      channelId: category.destination.channelId,
      interactionId: '777777777777777776',
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
      { ...base, intent: { action: 'route-manage', linkId: String(list.id), value: 'route' } },
      context,
    );
    assert.match(JSON.stringify(management), /Retry checks/);
    assert.match(JSON.stringify(management), /Discord creation began/);
    const control = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-manage' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    assert.ok(control);
    const retry = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-retry-checks', linkId: String(control.id) } },
      context,
    );
    assert.match(JSON.stringify(retry), /Checks queued/);
    assert.equal(
      (await readWorkOperation(db, workScope, partial.id))?.reason,
      'unconfirmed_effect',
    );
    Object.assign(discord, { discoverWork: () => Promise.resolve(null) });
    assert.equal(
      (await recoverOneWorkOperation(db, { notion, discord }, context)).reason,
      'unconfirmed_effect',
    );
    assert.equal((await readWorkOperation(db, workScope, partial.id))?.state, 'held');
    Object.assign(discord, {
      discoverWork: () =>
        Promise.resolve({
          forumId: '666666666666666666',
          threadId: '555555555555555555',
          starterMessageId: '555555555555555555',
        }),
    });
    const recheck = { ...context, clock: () => new Date(context.clock().getTime() + 301_000) };
    assert.equal(
      (await recoverOneWorkOperation(db, { notion, discord }, recheck)).kind,
      'progress',
    );
    const recovered = await readWorkOperation(db, workScope, partial.id);
    assert.equal(recovered?.state, 'queued');
    assert.equal(
      (JSON.parse(recovered.result_json ?? '{}') as { threadId?: string }).threadId,
      '555555555555555555',
    );
    assert.equal(creates, 0);
  } finally {
    db.raw.close();
  }
});
