import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { runMaintenance } from '@lasvegasfortransit/platform-storage/retention';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import type { Db, SqlValue, Statement } from '@lasvegasfortransit/platform-storage/db';

void test('idle profile maintenance reads stay bounded as unrelated retained history grows', async (t) => {
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
  const nativeStatements = new WeakMap<Statement, ReturnType<typeof db.prepare>>();
  function measure<T extends { meta: { rows_read?: number } }>(result: T): T {
    assert.equal(typeof result.meta.rows_read, 'number');
    reads += result.meta.rows_read ?? 0;
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
  const measurements: { history: number; reads: number }[] = [];
  let previousHistory = 0;
  for (const history of [0, 1000, 10_000]) {
    if (history)
      await db
        .prepare(
          `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?)
        INSERT INTO staff_audits(id,actor_id,action,target_id,details,occurred_at)
        SELECT 'history-'||?||'-'||n,'platform:discord','access.granted','unrelated','{"retained":true}','2026-01-01T00:00:00.000Z' FROM seq`,
        )
        .bind(history - previousHistory, history)
        .run();
    previousHistory = history;
    reads = 0;
    const idleBudget = queryBudget(measuredDb, 50);
    const result = await runMaintenance(idleBudget.db, { now, category: 'profiles' });
    assert.equal(idleBudget.queries, 1);
    assert.deepEqual(result, {
      viewsRemoved: 0,
      auditsRemoved: 0,
      claimsExpired: 0,
      profilesErased: 0,
      profilesRemoved: 0,
    });
    measurements.push({ history, reads });
  }
  t.diagnostic(JSON.stringify(measurements));
  for (const { history, reads } of measurements)
    assert.ok(
      reads <= 100,
      `${history} historical audits required ${reads} reads for idle maintenance`,
    );

  await t.test('new erasure and strict retention cutoff still run after an idle pass', async () => {
    const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    await db
      .prepare(
        `INSERT INTO people(id,given_name,email,created_at,updated_at,deleted_at)
      VALUES('new-deletion','Private name','private@example.invalid','2020-01-01','2020-01-01',?)`,
      )
      .bind(cutoff)
      .run();
    await db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,occurred_at)
        VALUES('erased-audit','staff','person.correct','new-deletion','{"private":"fixture"}','2026-01-01')`,
      )
      .run();
    await assert.rejects(
      db
        .prepare(
          `UPDATE staff_audits SET details='{"personalDataErased":true}' WHERE id='erased-audit'`,
        )
        .run(),
      /staff audits cannot be changed/,
    );
    reads = 0;
    const erasureBudget = queryBudget(measuredDb, 50);
    const erased = await runMaintenance(erasureBudget.db, { now, category: 'profiles' });
    t.diagnostic(JSON.stringify({ operation: 'erasure', queries: erasureBudget.queries, reads }));
    assert.ok(reads < 1000, `due erasure scanned ${reads} rows of unrelated history`);
    assert.equal(erasureBudget.queries, 50);
    assert.equal(erased.profilesErased, 1);
    assert.equal(erased.profilesRemoved, 0);
    assert.deepEqual(
      await db
        .prepare("SELECT given_name,email,erased_at FROM people WHERE id='new-deletion'")
        .first(),
      { given_name: null, email: null, erased_at: now.toISOString() },
    );
    assert.equal(
      (await db.prepare("SELECT details FROM staff_audits WHERE id='erased-audit'").first())
        ?.details,
      '{"personalDataErased":true}',
    );
    assert.equal(
      (
        await db
          .prepare("SELECT details FROM staff_audits WHERE target_id='unrelated' LIMIT 1")
          .first()
      )?.details,
      '{"retained":true}',
    );
    await assert.rejects(
      db.prepare("UPDATE staff_audits SET actor_id='changed' WHERE id='erased-audit'").run(),
      /staff audits cannot be changed/,
    );
    reads = 0;
    const purgeBudget = queryBudget(measuredDb, 50);
    const removed = await runMaintenance(purgeBudget.db, {
      now: new Date(now.getTime() + 1),
      category: 'profiles',
    });
    t.diagnostic(JSON.stringify({ operation: 'purge', queries: purgeBudget.queries, reads }));
    assert.ok(reads < 1000, `due purge scanned ${reads} rows of unrelated history`);
    assert.equal(purgeBudget.queries, 50);
    assert.equal(removed.profilesErased, 0);
    assert.equal(removed.profilesRemoved, 1);
    assert.equal(await db.prepare("SELECT 1 FROM people WHERE id='new-deletion'").first(), null);
    for (const table of ['person_erasure_scope', 'person_erasure_copies', 'person_retention_scope'])
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first())?.n, 0);
  });
});
