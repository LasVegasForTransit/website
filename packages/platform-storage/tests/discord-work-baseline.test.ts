import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { saveWorkRoute, activateWorkRoute, readWorkRoute } from '../src/discord-work-routes';
import {
  requestWorkRouteBaseline,
  claimWorkRouteScan,
  completeWorkRouteScanPage,
  readWorkRouteBaseline,
} from '../src/discord-work-route-scans';
import { recordWorkObservation } from '../src/discord-work-requests';

void test('a paused route is baselined without creating requests and only by an administrator', async () => {
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
    state: 'paused' as const,
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
    db.raw
      .prepare(
        "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('identity','person','discord','111111111111111111',?,'self_linked',?,?)",
      )
      .run(now.toISOString(), now.toISOString(), now.toISOString());
    await saveWorkRoute(db, { personId: 'person' }, { route: route, expected: 0 }, now);
    const approval = {
      discordUserId: '111111111111111111',
      grantVersion: 'grant',
      audienceFingerprint: 'audience',
    };
    assert.equal(
      await activateWorkRoute(
        db,
        { personId: 'person' },
        { scope: scope, id: route.id, expected: 1, approval: approval },
        now,
      ),
      false,
    );
    assert.equal(
      await requestWorkRouteBaseline(
        db,
        { personId: 'other' },
        { scope, routeId: route.id, revision: 1 },
        now,
      ),
      false,
    );
    assert.equal(
      await requestWorkRouteBaseline(
        db,
        { personId: 'person' },
        { scope, routeId: route.id, revision: 1 },
        now,
      ),
      true,
    );
    const first = await claimWorkRouteScan(db, scope, now);
    assert.ok(first);
    assert.equal(first.mode, 'baseline');
    await recordWorkObservation(
      db,
      {
        scope,
        routeId: route.id,
        revision: 1,
        pageId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        eligible: true,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        editedAt: now,
        scanToken: first.claim_token,
      },
      now,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_requests').get()?.n, 0);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_observations').get()?.n, 1);
    assert.equal(await completeWorkRouteScanPage(db, first, 'next', now), true);
    assert.equal(await readWorkRouteBaseline(db, scope, route.id, 1), false);
    const second = await claimWorkRouteScan(db, scope, now);
    assert.ok(second);
    assert.equal(second.cursor, 'next');
    assert.equal(await completeWorkRouteScanPage(db, second, null, now), true);
    assert.equal(await readWorkRouteBaseline(db, scope, route.id, 1), true);
    assert.equal(await claimWorkRouteScan(db, scope, now), null);
    db.raw.prepare("UPDATE identities SET link_method='verified_email' WHERE id='identity'").run();
    assert.equal(
      await activateWorkRoute(
        db,
        { personId: 'person' },
        { scope: scope, id: route.id, expected: 1, approval: approval },
        now,
      ),
      false,
      'a revoked identity cannot activate the route after preview',
    );
    db.raw.prepare("UPDATE identities SET link_method='self_linked' WHERE id='identity'").run();
    assert.equal(
      await activateWorkRoute(
        db,
        { personId: 'person' },
        {
          scope: scope,
          id: route.id,
          expected: 1,
          approval: { ...approval, audienceFingerprint: 'changed' },
        },
        now,
      ),
      false,
    );
    assert.equal(
      await activateWorkRoute(
        db,
        { personId: 'person' },
        { scope: scope, id: route.id, expected: 1, approval: approval },
        now,
      ),
      true,
    );
    assert.equal((await readWorkRoute(db, scope, route.id))?.state, 'active');
    const overlap = { ...route, id: 'a-overlap' };
    assert.equal(
      await saveWorkRoute(db, { personId: 'person' }, { route: overlap, expected: 0 }, now),
      true,
    );
    assert.equal(
      await requestWorkRouteBaseline(
        db,
        { personId: 'person' },
        { scope, routeId: overlap.id, revision: 1 },
        now,
      ),
      true,
    );
    const overlapScan = await claimWorkRouteScan(db, scope, now);
    assert.ok(overlapScan);
    assert.equal(overlapScan.route_id, overlap.id);
    assert.equal(await completeWorkRouteScanPage(db, overlapScan, null, now), true);
    assert.equal(
      await activateWorkRoute(
        db,
        { personId: 'person' },
        { scope: scope, id: overlap.id, expected: 1, approval: approval },
        now,
      ),
      false,
      'two routes cannot actively target the same source',
    );
    assert.equal(
      db.raw.prepare('SELECT revision FROM discord_work_observations').get()?.revision,
      1,
    );
    const active = await claimWorkRouteScan(db, scope, now);
    assert.ok(active);
    assert.equal(active.mode, 'scan');
    assert.equal(active.revision, 2);
    const observed = {
      scope,
      routeId: route.id,
      revision: 2,
      pageId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-10-01T00:00:00Z'),
      scanToken: active.claim_token,
    };
    db.raw
      .prepare(
        "INSERT INTO discord_work_requests(id,scope_key,source_id,page_id,route_id,route_revision,state,created_at) SELECT 'old-request',scope_key,source_id,?,id,1,'held',? FROM discord_work_routes WHERE id=?",
      )
      .run(observed.pageId, now.toISOString(), route.id);
    await recordWorkObservation(db, { ...observed, eligible: true, editedAt: now }, now);
    assert.deepEqual(
      { ...db.raw.prepare('SELECT id,existing_event FROM discord_work_requests').get() },
      { id: 'old-request', existing_event: 1 },
      'a rebased event requires matching even when an older request has a different ID',
    );
    const firstChange = new Date(now.getTime() + 1000),
      secondChange = new Date(now.getTime() + 2000);
    await recordWorkObservation(
      db,
      { ...observed, eligible: false, editedAt: firstChange },
      firstChange,
    );
    db.raw.prepare("UPDATE discord_work_requests SET state='held' WHERE id='old-request'").run();
    await recordWorkObservation(
      db,
      { ...observed, eligible: true, editedAt: secondChange },
      secondChange,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_requests').get()?.n, 1);
    assert.equal(
      db.raw.prepare('SELECT existing_event FROM discord_work_requests').get()?.existing_event,
      0,
      'a later eligibility transition is classified independently of the old request',
    );
    assert.equal(await completeWorkRouteScanPage(db, active, null, secondChange), true);
    assert.equal(
      await saveWorkRoute(
        db,
        { personId: 'person' },
        { route: { ...route, revision: 3 }, expected: 2 },
        secondChange,
      ),
      true,
    );
    assert.equal(
      await requestWorkRouteBaseline(
        db,
        { personId: 'person' },
        { scope, routeId: route.id, revision: 3 },
        secondChange,
      ),
      true,
    );
    assert.equal(
      await saveWorkRoute(
        db,
        { personId: 'person' },
        {
          route: { ...route, revision: 4, trigger: { property: 'Status', values: ['Ready'] } },
          expected: 3,
        },
        secondChange,
      ),
      true,
    );
    assert.equal(
      await activateWorkRoute(
        db,
        { personId: 'person' },
        { scope: scope, id: route.id, expected: 4, approval: approval },
        secondChange,
      ),
      false,
    );
    assert.equal(await readWorkRouteBaseline(db, scope, route.id, 4), false);
  } finally {
    db.raw.close();
  }
});
