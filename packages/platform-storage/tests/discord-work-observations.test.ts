import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, seedActiveWorkRoute } from './support/db';
import { saveWorkRoute } from '../src/discord-work-routes';
import { recordWorkObservation } from '../src/discord-work-requests';
import { enqueueWorkOperation } from '../src/discord-work-operations';

void test('observations enqueue once on an explicit eligibility transition or a new eligible page', async () => {
  const db = memoryDb();
  const scope = {
    environment: 'preview' as const,
    guildId: '222222222222222222',
    workspaceId: 'workspace',
  };
  const start = new Date('2026-10-22T12:00:00Z');
  const sourceId = '380c7791208f80b29868000bc287f878';
  const route = {
    id: 'route',
    scope,
    sourceId,
    kind: 'event' as const,
    state: 'active' as const,
    revision: 1,
    trigger: { property: 'Status', values: ['Planning'] },
    destination: { kind: 'text' as const, channelId: '333333333333333333' },
    approvedBy: 'person',
    audienceFingerprint: 'audience',
  };
  const pageId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const observation = {
    scope,
    routeId: 'route',
    revision: 1,
    pageId,
    eligible: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    editedAt: new Date('2026-10-22T12:01:00Z'),
  };
  const count = () => db.raw.prepare('SELECT count(*) AS n FROM discord_work_requests').get()?.n;
  try {
    db.raw
      .prepare(
        "INSERT INTO people(id,membership_status,created_at,updated_at) VALUES('person','member',?,?)",
      )
      .run(start.toISOString(), start.toISOString());
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('person','person',?)",
      )
      .run(start.toISOString());
    seedActiveWorkRoute(db, route, start);
    await recordWorkObservation(db, observation, new Date('2026-10-22T12:02:00Z'));
    assert.equal(count(), 0, 'an existing eligible page is baselined, not backfilled');
    await recordWorkObservation(
      db,
      { ...observation, eligible: false, editedAt: new Date('2026-10-22T12:03:00Z') },
      new Date('2026-10-22T12:04:00Z'),
    );
    await recordWorkObservation(
      db,
      { ...observation, editedAt: new Date('2026-10-22T12:05:00Z') },
      new Date('2026-10-22T12:06:00Z'),
    );
    assert.equal(count(), 1);
    await recordWorkObservation(
      db,
      { ...observation, editedAt: new Date('2026-10-22T12:05:00Z') },
      new Date('2026-10-22T12:07:00Z'),
    );
    await recordWorkObservation(
      db,
      { ...observation, eligible: false, editedAt: new Date('2026-10-22T12:03:00Z') },
      new Date('2026-10-22T12:08:00Z'),
    );
    assert.equal(count(), 1, 'duplicate and out-of-order observations do not duplicate work');
    await recordWorkObservation(
      db,
      {
        ...observation,
        pageId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        createdAt: new Date('2026-10-22T12:09:00Z'),
        editedAt: new Date('2026-10-22T12:09:00Z'),
      },
      new Date('2026-10-22T12:10:00Z'),
    );
    assert.equal(count(), 2);
    await saveWorkRoute(
      db,
      { personId: 'person' },
      { route: { ...route, state: 'paused', revision: 2 }, expected: 1 },
      new Date('2026-10-22T12:11:00Z'),
    );
    await recordWorkObservation(
      db,
      {
        ...observation,
        pageId: 'cccccccccccccccccccccccccccccccc',
        createdAt: new Date('2026-10-22T12:12:00Z'),
        editedAt: new Date('2026-10-22T12:12:00Z'),
      },
      new Date('2026-10-22T12:13:00Z'),
    );
    assert.equal(count(), 2, 'paused or revised routes cannot enqueue from stale observations');
    const old = db.raw.prepare('SELECT id FROM discord_work_requests WHERE page_id=?').get(pageId);
    seedActiveWorkRoute(db, { ...route, revision: 3 }, new Date('2026-10-22T12:14:00Z'));
    await recordWorkObservation(
      db,
      { ...observation, revision: 3, eligible: false, editedAt: new Date('2026-10-22T12:15:00Z') },
      new Date('2026-10-22T12:15:00Z'),
    );
    await recordWorkObservation(
      db,
      { ...observation, revision: 3, eligible: true, editedAt: new Date('2026-10-22T12:16:00Z') },
      new Date('2026-10-22T12:16:00Z'),
    );
    const revived = db.raw
      .prepare('SELECT id,route_revision,state FROM discord_work_requests WHERE page_id=?')
      .get(pageId);
    assert.ok(revived);
    assert.ok(old);
    assert.equal(revived.id, old.id);
    assert.equal(revived.route_revision, 3);
    assert.equal(revived.state, 'pending');
    db.raw
      .prepare(
        "UPDATE discord_work_requests SET state='held',reason='not_eligible' WHERE page_id=?",
      )
      .run(pageId);
    await recordWorkObservation(
      db,
      { ...observation, revision: 3, eligible: true, editedAt: new Date('2026-10-22T12:16:00Z') },
      new Date('2026-10-22T12:17:00Z'),
    );
    assert.equal(
      db.raw.prepare('SELECT state FROM discord_work_requests WHERE page_id=?').get(pageId)?.state,
      'held',
      'repeated eligible observations do not retry held work',
    );
    await recordWorkObservation(
      db,
      { ...observation, revision: 3, eligible: false, editedAt: new Date('2026-10-22T12:18:00Z') },
      new Date('2026-10-22T12:18:00Z'),
    );
    await recordWorkObservation(
      db,
      { ...observation, revision: 3, eligible: true, editedAt: new Date('2026-10-22T12:19:00Z') },
      new Date('2026-10-22T12:19:00Z'),
    );
    assert.equal(
      db.raw.prepare('SELECT state FROM discord_work_requests WHERE page_id=?').get(pageId)?.state,
      'pending',
      'a new eligibility transition retries a pre-creation hold',
    );
    db.raw
      .prepare(
        "UPDATE discord_work_requests SET state='held',operation_id='uncertain' WHERE page_id=?",
      )
      .run(pageId);
    seedActiveWorkRoute(db, { ...route, revision: 4 }, new Date('2026-10-22T12:20:00Z'));
    await recordWorkObservation(
      db,
      { ...observation, revision: 4, eligible: false, editedAt: new Date('2026-10-22T12:21:00Z') },
      new Date('2026-10-22T12:21:00Z'),
    );
    await recordWorkObservation(
      db,
      { ...observation, revision: 4, eligible: true, editedAt: new Date('2026-10-22T12:22:00Z') },
      new Date('2026-10-22T12:22:00Z'),
    );
    const held = db.raw
      .prepare(
        'SELECT route_revision,state,operation_id FROM discord_work_requests WHERE page_id=?',
      )
      .get(pageId);
    assert.deepEqual({ ...held }, { route_revision: 3, state: 'held', operation_id: 'uncertain' });
    db.raw
      .prepare('UPDATE discord_work_requests SET operation_id=NULL WHERE page_id=?')
      .run(pageId);
    assert.equal(
      await enqueueWorkOperation(
        db,
        {
          id: 'stranded-operation',
          scope,
          homeId: null,
          conversationId: null,
          generation: 1,
          kind: 'provision',
          sourceKey: `route-request:${String(old.id)}`,
          actorPersonId: 'person',
          actorDiscordId: '111111111111111111',
          originalAuthorId: '111111111111111111',
          grantVersion: 'grant',
          payload: {},
        },
        new Date('2026-10-22T12:22:00Z'),
      ),
      'queued',
    );
    await recordWorkObservation(
      db,
      { ...observation, revision: 4, eligible: false, editedAt: new Date('2026-10-22T12:23:00Z') },
      new Date('2026-10-22T12:23:00Z'),
    );
    await recordWorkObservation(
      db,
      { ...observation, revision: 4, eligible: true, editedAt: new Date('2026-10-22T12:24:00Z') },
      new Date('2026-10-22T12:24:00Z'),
    );
    assert.equal(
      db.raw.prepare('SELECT state FROM discord_work_requests WHERE page_id=?').get(pageId)?.state,
      'held',
      'a stranded operation also prevents retry',
    );
  } finally {
    db.raw.close();
  }
});

void test('a renewed eligibility transition resumes only a superseded pre-effect provision', async () => {
  const db = memoryDb();
  const scope = {
    environment: 'preview' as const,
    guildId: '222222222222222222',
    workspaceId: 'workspace',
  };
  const start = new Date('2026-10-22T12:00:00Z');
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
      .run(start.toISOString(), start.toISOString());
    seedActiveWorkRoute(db, route, start);
    const key = JSON.stringify([scope.environment, scope.guildId, scope.workspaceId]);
    for (const [id, page, result] of [
      ['race', 'cccccccccccccccccccccccccccccccc', null],
      ['safe', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', null],
      ['same', 'dddddddddddddddddddddddddddddddd', null],
      ['uncertain', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '{"forumId":"123"}'],
    ] as const) {
      db.raw
        .prepare(
          "INSERT INTO discord_work_requests(id,scope_key,source_id,page_id,route_id,route_revision,state,operation_id,created_at) VALUES(?,?,?,?,?,1,'superseded',?,?)",
        )
        .run(id, key, route.sourceId, page, route.id, `op-${id}`, start.toISOString());
      await enqueueWorkOperation(
        db,
        {
          id: `op-${id}`,
          scope,
          homeId: null,
          conversationId: null,
          generation: 1,
          kind: 'provision',
          sourceKey: `route-request:${id}`,
          actorPersonId: 'person',
          actorDiscordId: '111111111111111111',
          originalAuthorId: '111111111111111111',
          grantVersion: 'grant',
          payload: { routeId: route.id, routeRevision: 1 },
        },
        start,
      );
      db.raw
        .prepare(
          "UPDATE discord_work_operations SET state=?,reason='not_eligible',result_json=?,payload_json=json_set(payload_json,'$.ineligibleEditedAt',?) WHERE id=?",
        )
        .run(
          id === 'race' || id === 'same' ? 'processing' : 'superseded',
          result,
          id === 'same' ? '2026-10-22T12:03:00.000Z' : '2026-10-22T12:01:00.000Z',
          `op-${id}`,
        );
      const obs = {
        scope,
        routeId: route.id,
        revision: 1,
        pageId: page,
        eligible: false,
        createdAt: start,
        editedAt: new Date('2026-10-22T12:01:00Z'),
      };
      await recordWorkObservation(db, obs, new Date('2026-10-22T12:02:00Z'));
      await recordWorkObservation(
        db,
        { ...obs, eligible: true, editedAt: new Date('2026-10-22T12:03:00Z') },
        new Date('2026-10-22T12:04:00Z'),
      );
      if (id === 'race' || id === 'same') {
        db.raw
          .prepare("UPDATE discord_work_operations SET state='superseded' WHERE id=?")
          .run(`op-${id}`);
        await recordWorkObservation(
          db,
          { ...obs, eligible: true, editedAt: new Date('2026-10-22T12:03:00Z') },
          new Date('2026-10-22T12:05:00Z'),
        );
      }
    }
    const ops = db.raw
      .prepare('SELECT id,state FROM discord_work_operations ORDER BY id')
      .all()
      .map((row) => ({ ...row }));
    assert.deepEqual(ops, [
      { id: 'op-race', state: 'queued' },
      { id: 'op-safe', state: 'queued' },
      { id: 'op-same', state: 'superseded' },
      { id: 'op-uncertain', state: 'superseded' },
    ]);
    assert.equal(
      db.raw
        .prepare(
          "SELECT json_extract(payload_json,'$.ineligibleEditedAt') AS stamp FROM discord_work_operations WHERE id='op-race'",
        )
        .get()?.stamp,
      null,
      'a subsequent preflight must record its own ineligible version',
    );
    const requests = db.raw
      .prepare('SELECT id,state FROM discord_work_requests ORDER BY id')
      .all()
      .map((row) => ({ ...row }));
    assert.deepEqual(requests, [
      { id: 'race', state: 'processing' },
      { id: 'safe', state: 'processing' },
      { id: 'same', state: 'superseded' },
      { id: 'uncertain', state: 'superseded' },
    ]);
  } finally {
    db.raw.close();
  }
});
