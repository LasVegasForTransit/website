import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { pendingDiscordOperations } from '@lasvegasfortransit/platform-storage/discord-pending';
import { completeProviderOperations } from '@lasvegasfortransit/platform-storage/provider-completion';
import { runMaintenance } from '@lasvegasfortransit/platform-storage/retention';
import type { Db, SqlValue, Statement } from '@lasvegasfortransit/platform-storage/db';

void test('provider selectors read bounded pages of blocked shared work', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'lvbt-profile-maintenance-budget-'));
  const simulator = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("fixture"); } };',
      compatibilityDate: '2026-09-04',
      resourcePersistencePath: data,
      cf: false,
      telemetry: { enabled: false },
      d1Databases: { PLATFORM_DB: 'profile-maintenance-budget' },
      outboundService: () => {
        throw new Error('Profile maintenance must not call providers');
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
  let reads = 0;
  let writes = 0;
  const nativeStatements = new WeakMap<Statement, ReturnType<typeof db.prepare>>();
  function measure<T extends { meta: { rows_read?: number; rows_written?: number } }>(
    result: T,
  ): T {
    assert.equal(typeof result.meta.rows_read, 'number');
    reads += result.meta.rows_read ?? 0;
    writes += result.meta.rows_written ?? 0;
    return result;
  }
  function statement(sql: string, values: SqlValue[] = []): Statement {
    const native = db.prepare(sql).bind(...values);
    const wrapped: Statement = {
      bind: (...nextValues) => statement(sql, nextValues),
      first: async <T>() => measure(await native.all<T>()).results[0] ?? null,
      all: async <T>() => measure(await native.all<T>()),
      run: async () => measure(await native.run()),
    };
    nativeStatements.set(wrapped, native);
    return wrapped;
  }
  const measuredDb: Db = {
    prepare: statement,
    batch: async (statements) => {
      const results = await db.batch(
        statements.map((entry) => {
          const native = nativeStatements.get(entry);
          assert.ok(native);
          return native;
        }),
      );
      return results.map(measure);
    },
  };
  const now = new Date('2026-10-18T12:00:00.000Z');
  const measurements: { count: number; selector: string; reads: number; writes: number }[] = [];
  const idle: { pass: number; reads: number; writes: number }[] = [];
  for (const pass of [0, 1]) {
    reads = 0;
    writes = 0;
    assert.deepEqual(await pendingDiscordOperations(measuredDb, now, 1), []);
    assert.equal(await completeProviderOperations(measuredDb, { now }), 0);
    idle.push({ pass, reads, writes });
  }
  t.diagnostic(JSON.stringify({ idle }));
  assert.equal(idle[1]?.writes, 0, 'unchanged empty provider queues must not rewrite cursors');
  for (const count of [1000, 10_000, 100_000]) {
    await db
      .prepare(
        `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?)
      INSERT OR IGNORE INTO people(id,membership_status,created_at,updated_at) SELECT printf('p%05d',n),'member','2026-01-01','2026-01-01' FROM seq`,
      )
      .bind(count)
      .run();
    for (const provider of ['discord', 'google_workspace'])
      await db
        .prepare(
          `INSERT OR IGNORE INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
        SELECT ?||id,id,?,id,'2026-01-01','self_linked','2026-01-01','2026-01-01' FROM people`,
        )
        .bind(provider, provider)
        .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO reconcile_generations(person_id,target_id,generation) SELECT id,'person',1 FROM people`,
      )
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      SELECT id,'person_reconcile',id,'person',1,'{"source":"discord_drift"}','2026-01-01','2026-01-01','2026-01-01' FROM people`,
      )
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO provider_operation_receipts(operation_id,provider,state,revision_hash,lease_token,observed_at,expires_at)
      SELECT id,'discord','done','r','l','2026-10-18T11:59:00.000Z','2026-10-18T12:04:00.000Z' FROM integration_outbox`,
      )
      .run();
    reads = 0;
    writes = 0;
    assert.deepEqual(await pendingDiscordOperations(measuredDb, now, 1), []);
    measurements.push({ count, selector: 'discord', reads, writes });
    reads = 0;
    writes = 0;
    assert.equal(await completeProviderOperations(measuredDb, { now }), 0);
    measurements.push({ count, selector: 'completion', reads, writes });
  }
  await db
    .prepare("UPDATE people SET membership_status='former_member',updated_at=? WHERE id='p100000'")
    .bind(now.toISOString())
    .run();
  reads = 0;
  writes = 0;
  const selected = await pendingDiscordOperations(measuredDb, now, 1);
  assert.equal(selected.length, 1);
  const removalReads = reads;
  const removalWrites = writes;
  const [operationId] = selected;
  assert.ok(operationId);
  const removal = await db
    .prepare('SELECT person_id,payload FROM integration_outbox WHERE id=?')
    .bind(operationId)
    .first();
  assert.ok(removal);
  assert.equal(removal.person_id, 'p100000');
  const payload = JSON.parse(String(removal.payload)) as Record<string, unknown>;
  assert.equal(payload.removal, 1);
  measurements.push({
    count: 100_000,
    selector: 'fresh_removal',
    reads: removalReads,
    writes: removalWrites,
  });
  for (const category of ['records', 'profiles', 'inactive', 'inactive'] as const) {
    reads = 0;
    writes = 0;
    await runMaintenance(measuredDb, { now, category });
    measurements.push({ count: 100_000, selector: category, reads, writes });
  }
  t.diagnostic(JSON.stringify(measurements));
  for (const measurement of measurements)
    assert.ok(measurement.reads < 1000, JSON.stringify(measurement));
});
