import { seedActiveWorkRoute } from '@lasvegasfortransit/platform-storage/test-db';
import assert from 'node:assert/strict';
import test from 'node:test';
import { saveWorkRoute } from '@lasvegasfortransit/platform-storage/discord-work-routes';
import {
  requestWorkRouteBaseline,
  readWorkRouteBaseline,
} from '@lasvegasfortransit/platform-storage/discord-work-route-scans';
import { runWorkRouteScan } from '../src/discord-work-route-scan';
import { workFixture, workScope, workNow, sourceId } from './support/discord-work';

void test('route reconciliation advances a bounded cursor and records eligible pages once', async () => {
  const { db, notion } = workFixture();
  const route = {
    id: 'route',
    scope: workScope,
    sourceId,
    kind: 'event' as const,
    state: 'active' as const,
    revision: 1,
    trigger: { property: 'Status', values: ['Planning'] },
    destination: { kind: 'text' as const, channelId: '333333333333333333' },
    approvedBy: 'guest',
    audienceFingerprint: 'audience',
  };
  const calls: (string | null)[] = [];
  Object.assign(notion, {
    queryWorkSource: (_source: string, cursor: string | null) => {
      calls.push(cursor);
      return Promise.resolve({
        results: [
          {
            object: 'page',
            id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            parent: { data_source_id: sourceId },
            created_time: '2026-10-01T00:00:00.000Z',
            last_edited_time: cursor ? '2026-10-22T12:02:00.000Z' : '2026-10-22T12:01:00.000Z',
            properties: {
              Status: { type: 'status', status: { name: cursor ? 'Planning' : 'Not started' } },
            },
          },
        ],
        nextCursor: cursor ? null : 'next',
      });
    },
  });
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    seedActiveWorkRoute(db, route, workNow);
    assert.equal((await runWorkRouteScan(db, notion, workScope, () => workNow)).kind, 'progress');
    const query = notion.queryWorkSource.bind(notion);
    Object.assign(notion, { queryWorkSource: () => Promise.reject(new Error('offline')) });
    assert.equal(
      (await runWorkRouteScan(db, notion, workScope, () => new Date(workNow.getTime() + 1_000)))
        .kind,
      'paused',
    );
    assert.equal(
      db.raw
        .prepare('SELECT last_error FROM discord_work_route_scans WHERE route_id=?')
        .get(route.id)?.last_error,
      'source_unavailable',
    );
    Object.assign(notion, { queryWorkSource: query });
    assert.equal(
      (await runWorkRouteScan(db, notion, workScope, () => new Date(workNow.getTime() + 180_000)))
        .kind,
      'progress',
    );
    assert.deepEqual(calls, [null, 'next']);
    assert.equal(
      db.raw
        .prepare('SELECT last_error FROM discord_work_route_scans WHERE route_id=?')
        .get(route.id)?.last_error,
      null,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_requests').get()?.n, 1);
  } finally {
    db.raw.close();
  }
});

void test('a paused route can scan a baseline without queuing existing eligible pages', async () => {
  const { db, notion } = workFixture();
  const route = {
    id: 'baseline',
    scope: workScope,
    sourceId,
    kind: 'event' as const,
    state: 'paused' as const,
    revision: 1,
    trigger: { property: 'Status', values: ['Planning'] },
    destination: { kind: 'text' as const, channelId: '333333333333333333' },
    approvedBy: 'guest',
    audienceFingerprint: 'audience',
  };
  Object.assign(notion, {
    queryWorkSource: () =>
      Promise.resolve({
        results: [
          {
            object: 'page',
            id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            parent: { data_source_id: sourceId },
            created_time: '2026-10-01T00:00:00.000Z',
            last_edited_time: '2026-10-22T12:00:00.000Z',
            properties: { Status: { type: 'status', status: { name: 'Planning' } } },
          },
        ],
        nextCursor: null,
      }),
  });
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    await saveWorkRoute(db, { personId: 'guest' }, { route: route, expected: 0 }, workNow);
    await requestWorkRouteBaseline(
      db,
      { personId: 'guest' },
      { scope: workScope, routeId: route.id, revision: 1 },
      workNow,
    );
    assert.equal((await runWorkRouteScan(db, notion, workScope, () => workNow)).kind, 'progress');
    assert.equal(await readWorkRouteBaseline(db, workScope, route.id, 1), true);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_requests').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
