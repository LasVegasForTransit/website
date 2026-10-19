import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import type { Db, Statement } from '../src/db';
import {
  reserveScheduledWork,
  settleScheduledWork,
  SCHEDULED_CONTROL_ALLOWANCE,
} from '../src/scheduled-work-budget';

function fixture() {
  const native = memoryDb();
  const wrap = (statement: Statement): Statement => ({
    bind: (...values) => wrap(statement.bind(...values)),
    first: () => statement.first(),
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors D1 row typing
    all: async <T>() => ({
      ...(await statement.all<T>()),
      meta: { rows_read: 1, rows_written: 1 },
    }),
    run: () => statement.run(),
  });
  const db: Db = {
    prepare: (sql) => wrap(native.prepare(sql)),
    batch: (statements) => native.batch(statements),
  };
  return { db, native };
}
const at = (time = '2026-10-19T12:00:00.000Z') => new Date(time);
const usage = {
  rows_read: 100,
  rows_written: 5,
  metadata_missing: 0,
  database_errors: 0,
  quota_exhausted: false,
};

void test('only one concurrent parent obtains the atomic reservation', async () => {
  const f = fixture();
  try {
    const leases = await Promise.all([
      reserveScheduledWork(f.db, 'production', at(), 'first'),
      reserveScheduledWork(f.db, 'production', at(), 'second'),
    ]);
    assert.equal(leases.filter(Boolean).length, 1);
  } finally {
    f.native.raw.close();
  }
});
void test('settlement refunds only verified usage and closes persistently on an error', async () => {
  const f = fixture();
  try {
    const lease = await reserveScheduledWork(f.db, 'production', at(), 'first');
    assert.ok(lease);
    await settleScheduledWork(f.db, lease, usage, { failed: false, now: at() });
    const row = f.native.raw.prepare('SELECT * FROM scheduled_work_budget').get();
    assert.ok(row);
    assert.ok(Number(row.charged_reads) >= 101 && Number(row.charged_reads) < 50_000);
    const second = await reserveScheduledWork(f.db, 'production', at(), 'second');
    assert.ok(second);
    await settleScheduledWork(f.db, second, usage, { failed: true, now: at() });
    assert.equal(
      await reserveScheduledWork(f.db, 'production', at('2026-10-19T13:00:00Z'), 'third'),
      null,
    );
    assert.ok(
      await reserveScheduledWork(f.db, 'production', at('2026-10-20T00:00:00Z'), 'next_day'),
    );
  } finally {
    f.native.raw.close();
  }
});
void test('crashed reservations retain their charge and stale owners cannot refund a newer lease', async () => {
  const f = fixture();
  try {
    const first = await reserveScheduledWork(f.db, 'production', at(), 'first');
    assert.ok(first);
    assert.equal(
      await reserveScheduledWork(f.db, 'production', at('2026-10-19T12:01:00Z'), 'overlap'),
      null,
    );
    const second = await reserveScheduledWork(
      f.db,
      'production',
      at('2026-10-19T12:03:00Z'),
      'second',
    );
    assert.ok(second);
    await settleScheduledWork(f.db, first, usage, {
      failed: false,
      now: at('2026-10-19T12:03:01Z'),
    });
    const row = f.native.raw.prepare('SELECT * FROM scheduled_work_budget').get();
    assert.ok(row);
    assert.equal(row.lease_token, 'second');
    assert.equal(row.charged_reads, 100_000);
  } finally {
    f.native.raw.close();
  }
});
void test('old UTC day settlement cannot alter the next day ledger', async () => {
  const f = fixture();
  try {
    const old = await reserveScheduledWork(f.db, 'production', at('2026-10-19T23:59:00Z'), 'old');
    assert.ok(old);
    const next = await reserveScheduledWork(f.db, 'production', at('2026-10-20T00:02:00Z'), 'next');
    assert.ok(next);
    await settleScheduledWork(f.db, old, usage, { failed: false, now: at('2026-10-20T00:02:01Z') });
    assert.equal(
      f.native.raw.prepare('SELECT charged_reads FROM scheduled_work_budget').get()?.charged_reads,
      50_000,
    );
  } finally {
    f.native.raw.close();
  }
});
void test('preview and production retain separate conservative daily caps', async () => {
  for (const [environment, runs] of [
    ['production', 20],
    ['preview', 2],
  ] as const) {
    const f = fixture();
    try {
      for (let i = 0; i < runs; i++)
        assert.ok(
          await reserveScheduledWork(
            f.db,
            environment,
            new Date(at().getTime() + i * 121_000),
            `run_${i}`,
          ),
        );
      assert.equal(
        await reserveScheduledWork(
          f.db,
          environment,
          new Date(at().getTime() + runs * 121_000),
          'over_cap',
        ),
        null,
      );
    } finally {
      f.native.raw.close();
    }
  }
});

void test('settlement is idempotent and never refunds a reservation twice', async () => {
  const f = fixture();
  try {
    const lease = await reserveScheduledWork(f.db, 'production', at(), 'first');
    assert.ok(lease);
    await settleScheduledWork(f.db, lease, usage, { failed: false, now: at() });
    const before = f.native.raw
      .prepare('SELECT charged_reads,charged_writes FROM scheduled_work_budget')
      .get();
    await settleScheduledWork(f.db, lease, usage, { failed: false, now: at() });
    assert.deepEqual(
      f.native.raw.prepare('SELECT charged_reads,charged_writes FROM scheduled_work_budget').get(),
      before,
    );
  } finally {
    f.native.raw.close();
  }
});
void test('missing metadata and measured overshoots retain the reservation and close the day', async () => {
  for (const sample of [
    { ...usage, metadata_missing: 1 },
    { ...usage, rows_read: 60_000 },
    { ...usage, database_errors: 1 },
  ]) {
    const f = fixture();
    try {
      const lease = await reserveScheduledWork(f.db, 'production', at(), 'first');
      assert.ok(lease);
      await settleScheduledWork(f.db, lease, sample, { failed: false, now: at() });
      assert.equal(await reserveScheduledWork(f.db, 'production', at(), 'second'), null);
      const row = f.native.raw
        .prepare('SELECT charged_reads,charged_writes FROM scheduled_work_budget')
        .get();
      assert.ok(row);
      assert.ok(Number(row.charged_reads) >= 50_000 && Number(row.charged_writes) >= 2_000);
    } finally {
      f.native.raw.close();
    }
  }
});

void test('missing guard metadata admits no work and keeps a persistent closed ledger after settlement', async () => {
  const f = fixture();
  try {
    const unmeasured: Db = {
      prepare: (sql) => f.native.prepare(sql),
      batch: (statements) => f.native.batch(statements),
    };
    const lease = await reserveScheduledWork(unmeasured, 'production', at(), 'first');
    assert.ok(lease);
    assert.equal(lease.metadataMissing, 1);
    await settleScheduledWork(f.db, lease, usage, { failed: false, now: at() });
    assert.equal(await reserveScheduledWork(f.db, 'production', at(), 'second'), null);
  } finally {
    f.native.raw.close();
  }
});
void test('missing settlement metadata closes the day and cannot release an unverified refund', async () => {
  const f = fixture();
  try {
    const lease = await reserveScheduledWork(f.db, 'production', at(), 'first');
    assert.ok(lease);
    const unmeasured: Db = {
      prepare: (sql) => f.native.prepare(sql),
      batch: (statements) => f.native.batch(statements),
    };
    await assert.rejects(
      settleScheduledWork(unmeasured, lease, usage, { failed: false, now: at() }),
      /settlement accounting failed/,
    );
    assert.equal(await reserveScheduledWork(f.db, 'production', at(), 'second'), null);
  } finally {
    f.native.raw.close();
  }
});

function interceptUpdates(db: Db, after: (result: unknown) => Promise<unknown>): Db {
  const wrap = (sql: string, statement: Statement): Statement => ({
    bind: (...values) => wrap(sql, statement.bind(...values)),
    first: () => statement.first(),
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors D1 row typing
    all: async <T>() => {
      const result = await statement.all<T>();
      return (sql.startsWith('UPDATE scheduled_work_budget') ? await after(result) : result) as {
        results: T[];
      };
    },
    run: () => statement.run(),
  });
  return {
    prepare: (sql) => wrap(sql, db.prepare(sql)),
    batch: (statements) => db.batch(statements),
  };
}

void test('a successor cannot enter between committed accounting and missing-metadata verification', async () => {
  const f = fixture();
  try {
    const lease = await reserveScheduledWork(f.db, 'production', at(), 'owner');
    assert.ok(lease);
    let successor: Awaited<ReturnType<typeof reserveScheduledWork>> | undefined;
    let intercepted = false;
    const raced = interceptUpdates(f.db, async (result) => {
      if (intercepted) return result;
      intercepted = true;
      successor = await reserveScheduledWork(
        f.db,
        'production',
        at('2026-10-19T12:03:00Z'),
        'successor',
      );
      return { results: [{ id: 1 }] };
    });
    await assert.rejects(
      settleScheduledWork(raced, lease, usage, { failed: false, now: at('2026-10-19T12:03:00Z') }),
      /settlement accounting failed/,
    );
    assert.equal(successor, null);
    const row = f.native.raw
      .prepare('SELECT blocked,charged_reads,lease_token FROM scheduled_work_budget')
      .get();
    assert.ok(row);
    assert.equal(row.blocked, 1);
    assert.equal(row.charged_reads, 50_000);
    assert.notEqual(row.lease_token, '');
  } finally {
    f.native.raw.close();
  }
});
void test('a lost postcommit accounting response retains the closed full reservation', async () => {
  const f = fixture();
  try {
    const lease = await reserveScheduledWork(f.db, 'production', at(), 'owner');
    assert.ok(lease);
    const lost = interceptUpdates(f.db, () => Promise.reject(new Error('transport response lost')));
    await assert.rejects(
      settleScheduledWork(lost, lease, usage, { failed: false, now: at() }),
      /transport response lost/,
    );
    assert.equal(
      await reserveScheduledWork(f.db, 'production', at('2026-10-19T12:03:00Z'), 'successor'),
      null,
    );
    assert.equal(
      f.native.raw.prepare('SELECT charged_reads FROM scheduled_work_budget').get()?.charged_reads,
      50_000,
    );
  } finally {
    f.native.raw.close();
  }
});

void test('verified accounting remains closed until the fenced final release', async () => {
  const f = fixture();
  try {
    const lease = await reserveScheduledWork(f.db, 'production', at(), 'owner');
    assert.ok(lease);
    let updates = 0;
    const raced = interceptUpdates(f.db, async (result) => {
      updates++;
      if (updates === 1) {
        assert.equal(
          await reserveScheduledWork(f.db, 'production', at('2026-10-19T12:03:00Z'), 'too_early'),
          null,
        );
        assert.equal(
          f.native.raw.prepare('SELECT charged_reads FROM scheduled_work_budget').get()
            ?.charged_reads,
          50_000,
        );
      }
      return result;
    });
    await settleScheduledWork(raced, lease, usage, {
      failed: false,
      now: at('2026-10-19T12:03:00Z'),
    });
    assert.equal(updates, 2);
    assert.ok(
      await reserveScheduledWork(
        f.db,
        'production',
        at('2026-10-19T12:03:00Z'),
        'verified_successor',
      ),
    );
  } finally {
    f.native.raw.close();
  }
});
void test('lost final-release acknowledgment reports uncertainty after verified costs were charged', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'log', (line: string) => logs.push(line));
  const f = fixture();
  try {
    const lease = await reserveScheduledWork(f.db, 'production', at(), 'owner');
    assert.ok(lease);
    let updates = 0;
    const lost = interceptUpdates(f.db, (result) => {
      updates++;
      return updates === 2
        ? Promise.reject(new Error('postcommit release response lost'))
        : Promise.resolve(result);
    });
    await assert.rejects(
      settleScheduledWork(lost, lease, usage, { failed: false, now: at() }),
      /release acknowledgment unavailable/,
    );
    const row = f.native.raw
      .prepare('SELECT blocked,charged_reads,charged_writes FROM scheduled_work_budget')
      .get();
    assert.ok(row);
    assert.equal(row.blocked, 0, 'the last write committed despite its missing acknowledgment');
    assert.equal(
      row.charged_reads,
      usage.rows_read + lease.guardReads + SCHEDULED_CONTROL_ALLOWANCE.reads,
    );
    assert.equal(
      row.charged_writes,
      usage.rows_written + lease.guardWrites + SCHEDULED_CONTROL_ALLOWANCE.writes,
    );
    assert.ok(logs.some((line) => line.includes('scheduled_budget_release_uncertain')));
    assert.ok(!logs.some((line) => line.includes('scheduled_budget_settled')));
  } finally {
    f.native.raw.close();
  }
});
