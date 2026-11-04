import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, seedActiveWorkRoute } from './support/db';
import { saveWorkRoute } from '../src/discord-work-routes';
import { claimWorkRouteScan, completeWorkRouteScanPage } from '../src/discord-work-route-scans';
import { recordWorkObservation } from '../src/discord-work-requests';

void test('route scans lease pages, resume cursors, and fence paused or changed routes', async () => {
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
    const first = await claimWorkRouteScan(db, scope, now);
    assert.ok(first);
    assert.equal(first.cursor, null);
    assert.equal(await claimWorkRouteScan(db, scope, now), null);
    assert.equal(await completeWorkRouteScanPage(db, first, 'next', now), true);
    const second = await claimWorkRouteScan(db, scope, now);
    assert.ok(second);
    assert.equal(second.cursor, 'next');
    await saveWorkRoute(
      db,
      { personId: 'person' },
      { route: { ...route, state: 'paused', revision: 2 }, expected: 1 },
      now,
    );
    assert.equal(await completeWorkRouteScanPage(db, second, null, now), false);
    assert.equal(await claimWorkRouteScan(db, scope, now), null);
    seedActiveWorkRoute(db, { ...route, revision: 3 }, now);
    const resumed = await claimWorkRouteScan(db, scope, new Date(now.getTime() + 61_000));
    assert.ok(resumed);
    assert.equal(resumed.revision, 3);
    assert.equal(resumed.cursor, null);
    const later = new Date(now.getTime() + 122_000);
    assert.equal(
      await recordWorkObservation(
        db,
        {
          scope,
          routeId: route.id,
          revision: 3,
          pageId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          eligible: true,
          createdAt: new Date(now.getTime() + 1_000),
          editedAt: new Date(now.getTime() + 1_000),
          scanToken: resumed.claim_token,
        },
        later,
      ),
      false,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_observations').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
