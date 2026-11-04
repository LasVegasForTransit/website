import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, seedActiveWorkRoute } from './support/db';
import {
  retryHeldWorkRequests,
  retryEligibilityRecovery,
  nextWorkRouteRequest,
  queueWorkRouteRequest,
  holdWorkRouteRequest,
  deferWorkRouteRequest,
} from '../src/discord-work-requests';
import { enqueueWorkOperation } from '../src/discord-work-operations';

void test('a stale event classification cannot queue or hold a newer request', async () => {
  const db = memoryDb();
  const now = new Date('2026-10-22T12:00:00Z');
  const scope = {
    environment: 'preview' as const,
    guildId: '222222222222222222',
    workspaceId: 'workspace',
  };
  const actor = { personId: 'person', discordUserId: '111111111111111111', grantVersion: 'grant' };
  const route = {
    id: 'route',
    scope,
    sourceId: '380c7791208f80b29868000bc287f878',
    kind: 'event' as const,
    state: 'active' as const,
    revision: 1,
    trigger: { property: 'Status', values: ['Planning'] },
    destination: { kind: 'forum' as const, channelId: '333333333333333333' },
    approvedBy: actor.personId,
    approvedDiscordId: actor.discordUserId,
    approvedGrantVersion: actor.grantVersion,
    audienceFingerprint: 'audience',
  };
  try {
    db.raw
      .prepare(
        "INSERT INTO people(id,membership_status,created_at,updated_at) VALUES('person','member',?,?)",
      )
      .run(now.toISOString(), now.toISOString());
    seedActiveWorkRoute(db, route, now);
    db.raw
      .prepare(
        "INSERT INTO discord_work_requests(id,scope_key,source_id,page_id,route_id,route_revision,state,created_at) VALUES('request',?,?,?,'route',1,'pending',?)",
      )
      .run(
        JSON.stringify([scope.environment, scope.guildId, scope.workspaceId]),
        route.sourceId,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        now.toISOString(),
      );
    const stale = await nextWorkRouteRequest(db, scope, now);
    assert.ok(stale);
    db.raw.prepare("UPDATE discord_work_requests SET existing_event=1 WHERE id='request'").run();
    assert.equal(
      await queueWorkRouteRequest(
        db,
        { scope, request: stale, effect: { actor, payload: {} } },
        now,
      ),
      false,
    );
    await holdWorkRouteRequest(db, scope, stale, 'stale');
    await deferWorkRouteRequest(
      db,
      { scope, request: stale, retry: { reason: 'stale', retryAfterMs: 1000 } },
      now,
    );
    assert.deepEqual(
      {
        ...db.raw
          .prepare(
            "SELECT state,reason,next_attempt_at FROM discord_work_requests WHERE id='request'",
          )
          .get(),
      },
      { state: 'pending', reason: null, next_attempt_at: null },
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_operations').get()?.n, 0);
    const current = await nextWorkRouteRequest(db, scope, now);
    assert.ok(current);
    assert.equal(current.existing_event, 1);
    assert.equal(
      await queueWorkRouteRequest(
        db,
        { scope, request: current, effect: { actor, payload: {} } },
        now,
      ),
      true,
    );
  } finally {
    db.raw.close();
  }
});

void test('only an administrator may retry held checks with no possible provision operation', async () => {
  const db = memoryDb(),
    now = new Date('2026-10-22T12:00:00Z');
  const scope = {
    environment: 'preview' as const,
    guildId: '222222222222222222',
    workspaceId: 'workspace',
  };
  const route = {
    id: 'route',
    scope,
    sourceId: '380c7791208f80b29868000bc287f878',
    kind: 'event' as const,
    state: 'active' as const,
    revision: 1,
    trigger: { property: 'Status', values: ['Planning'] },
    destination: { kind: 'text' as const, channelId: '333333333333333333' },
    approvedBy: 'person',
    audienceFingerprint: 'audience',
  };
  try {
    db.raw
      .prepare(
        "INSERT INTO people(id,membership_status,created_at,updated_at) VALUES('person','member',?,?)",
      )
      .run(now.toISOString(), now.toISOString());
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('person','person',?)",
      )
      .run(now.toISOString());
    seedActiveWorkRoute(db, route, now);
    const insert = db.raw.prepare(
      "INSERT INTO discord_work_requests(id,scope_key,source_id,page_id,route_id,route_revision,state,operation_id,created_at) VALUES(?,?,?,?,?,1,'held',?,?)",
    );
    const key = JSON.stringify([scope.environment, scope.guildId, scope.workspaceId]);
    insert.run(
      'safe',
      key,
      route.sourceId,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      route.id,
      null,
      now.toISOString(),
    );
    insert.run(
      'linked',
      key,
      route.sourceId,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      route.id,
      'uncertain',
      now.toISOString(),
    );
    insert.run(
      'stranded',
      key,
      route.sourceId,
      'cccccccccccccccccccccccccccccccc',
      route.id,
      null,
      now.toISOString(),
    );
    await enqueueWorkOperation(
      db,
      {
        id: 'operation',
        scope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'route-request:stranded',
        actorPersonId: 'person',
        actorDiscordId: '111111111111111111',
        originalAuthorId: '111111111111111111',
        grantVersion: 'grant',
        payload: {},
      },
      now,
    );
    assert.equal(
      await retryHeldWorkRequests(
        db,
        { personId: 'other' },
        { scope: scope, routeId: route.id, revision: 1 },
        now,
      ),
      false,
    );
    assert.equal(
      await retryHeldWorkRequests(
        db,
        { personId: 'person' },
        { scope: scope, routeId: route.id, revision: 2 },
        now,
      ),
      false,
    );
    assert.equal(
      await retryHeldWorkRequests(
        db,
        { personId: 'person' },
        { scope: scope, routeId: route.id, revision: 1 },
        now,
      ),
      true,
    );
    const states = db.raw.prepare('SELECT id,state FROM discord_work_requests ORDER BY id').all();
    assert.deepEqual(
      states.map((row) => ({ ...row })),
      [
        { id: 'linked', state: 'held' },
        { id: 'safe', state: 'pending' },
        { id: 'stranded', state: 'held' },
      ],
    );
  } finally {
    db.raw.close();
  }
});

void test('only an administrator can request evidence-based recovery after an eligibility hold', async () => {
  const db = memoryDb();
  const now = new Date('2026-10-22T12:00:00Z');
  const scope = {
    environment: 'preview' as const,
    guildId: '222222222222222222',
    workspaceId: 'workspace',
  };
  const route = {
    id: 'route',
    scope,
    sourceId: '380c7791208f80b29868000bc287f878',
    kind: 'event' as const,
    state: 'active' as const,
    revision: 1,
    trigger: { property: 'Status', values: ['Planning'] },
    destination: { kind: 'text' as const, channelId: '333333333333333333' },
    approvedBy: 'person',
    audienceFingerprint: 'audience',
  };
  try {
    db.raw
      .prepare(
        "INSERT INTO people(id,membership_status,created_at,updated_at) VALUES('person','member',?,?)",
      )
      .run(now.toISOString(), now.toISOString());
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('person','person',?)",
      )
      .run(now.toISOString());
    seedActiveWorkRoute(db, route, now);
    const key = JSON.stringify([scope.environment, scope.guildId, scope.workspaceId]);
    db.raw
      .prepare(
        "INSERT INTO discord_work_requests(id,scope_key,source_id,page_id,route_id,route_revision,state,operation_id,created_at) VALUES('request',?,?,?,'route',1,'held','operation',?)",
      )
      .run(key, route.sourceId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', now.toISOString());
    await enqueueWorkOperation(
      db,
      {
        id: 'operation',
        scope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'route-request:request',
        actorPersonId: 'person',
        actorDiscordId: '111111111111111111',
        originalAuthorId: '111111111111111111',
        grantVersion: 'grant',
        payload: { intent: 'home', routeId: 'route', routeRevision: 1 },
      },
      now,
    );
    db.raw
      .prepare(
        "UPDATE discord_work_operations SET state='held',reason='eligibility_changed_after_effect',result_json=? WHERE id='operation'",
      )
      .run('{"forumId":"123"}');
    assert.equal(
      await retryEligibilityRecovery(
        db,
        { personId: 'other' },
        { scope: scope, routeId: 'route', revision: 1 },
        now,
      ),
      false,
    );
    assert.equal(
      await retryEligibilityRecovery(
        db,
        { personId: 'person' },
        { scope: scope, routeId: 'route', revision: 2 },
        now,
      ),
      false,
    );
    assert.equal(
      await retryEligibilityRecovery(
        db,
        { personId: 'person' },
        { scope: scope, routeId: 'route', revision: 1 },
        now,
      ),
      true,
    );
    const operation = db.raw
      .prepare("SELECT state,reason,result_json FROM discord_work_operations WHERE id='operation'")
      .get();
    assert.deepEqual(
      { ...operation },
      { state: 'held', reason: 'unconfirmed_effect', result_json: '{"forumId":"123"}' },
    );
  } finally {
    db.raw.close();
  }
});
