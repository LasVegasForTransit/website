import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { accessObservationBatchWrite } from '@lasvegasfortransit/platform-storage/access-observations';

void test('access snapshot reads stay bounded as retained observation history grows', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'lvbt-observation-budget-'));
  const simulator = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("fixture"); } };',
      compatibilityDate: '2026-09-04',
      resourcePersistencePath: data,
      cf: false,
      telemetry: { enabled: false },
      d1Databases: { PLATFORM_DB: 'observation-budget' },
      outboundService: () => {
        throw new Error('Observation storage must not call providers');
      },
    }),
  );
  t.after(async () => {
    await simulator.dispose();
    await rm(data, { recursive: true, force: true });
  });
  const db = await simulator.getD1Database('PLATFORM_DB');
  await db.prepare('SELECT 1').first();
  const file = (await readdir(data, { recursive: true })).find(
    (name) => name.includes('d1') && name.endsWith('.sqlite'),
  );
  assert.ok(file);
  const raw = new DatabaseSync(join(data, file));
  try {
    applyMigrations(raw);
  } finally {
    raw.close();
  }
  const now = new Date('2026-10-18T12:00:00.000Z');
  await db.batch([
    db.prepare("UPDATE committees SET discord_role_id='role' WHERE id='events'"),
    db.prepare(`INSERT INTO people(id,membership_status,created_at,updated_at)
      VALUES('person','member','2026-01-01','2026-01-01')`),
    db.prepare(`INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
      VALUES('identity','person','discord','account','2026-01-01','self_linked','2026-01-01','2026-01-01')`),
  ]);
  const observation = {
    personId: 'person',
    targetId: 'events',
    provider: 'discord' as const,
    identityId: 'account',
    identityEmail: null,
    resourceId: 'role',
    contextId: 'guild',
    generation: 0,
    expectedAccess: false,
    state: 'granted' as const,
    observedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 300_000).toISOString(),
  };
  const measurements: { history: number; reads: number }[] = [];
  for (const history of [0, 1000, 10_000]) {
    await db.batch([
      db.prepare('DELETE FROM access_observations'),
      db.prepare('DELETE FROM access_mismatch_observations'),
    ]);
    if (history)
      await db
        .prepare(
          `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?)
          INSERT INTO access_observations(id,person_id,target_id,provider,identity_id,identity_email,
            resource_id,context_id,generation,expected_access,state,observed_at,expires_at)
          SELECT 'history-'||n,'person','events','discord','account',NULL,'role','guild',0,0,'unknown',
            '2026-01-01T00:00:00.000Z','2026-01-01T00:05:00.000Z' FROM seq`,
        )
        .bind(history)
        .run();
    const statement = accessObservationBatchWrite(
      db,
      [
        observation,
        { ...observation, identityId: 'other-account' },
        { ...observation, generation: 99 },
        { ...observation, expectedAccess: true },
      ],
      now,
      { sql: '?=1', values: [1] },
    );
    assert.ok(statement);
    const { meta } = await statement.run();
    assert.ok('rows_read' in meta && typeof meta.rows_read === 'number');
    measurements.push({ history, reads: meta.rows_read });
    const { results } = await db
      .prepare(
        'SELECT identity_id,state,expected_access FROM access_observations WHERE observed_at=?',
      )
      .bind(now.toISOString())
      .all();
    assert.deepEqual(results, [{ identity_id: 'account', state: 'granted', expected_access: 0 }]);
    assert.equal(
      (await db.prepare('SELECT count(*) AS total FROM access_observations').first())?.total,
      history + 1,
      'saving a snapshot must retain the existing observation history',
    );
    assert.deepEqual(
      await db
        .prepare(
          'SELECT expected_access,first_seen_at,last_seen_at FROM access_mismatch_observations',
        )
        .first(),
      { expected_access: 0, first_seen_at: now.toISOString(), last_seen_at: now.toISOString() },
    );
  }
  t.diagnostic(JSON.stringify(measurements));
  for (const { history, reads } of measurements)
    assert.ok(
      reads > 0 && reads <= 500,
      `${history} historical observations required ${reads} reads`,
    );
});
