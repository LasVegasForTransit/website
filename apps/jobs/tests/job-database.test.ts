import assert from 'node:assert/strict';
import test from 'node:test';
import type { Db, Statement } from '@lasvegasfortransit/platform-storage/db';
import { runMeteredJob } from '../src/job-database';
import { scheduledStep } from '../src/scheduled-step';

function database(error?: Error): Db {
  const statement: Statement = {
    bind: () => statement,
    first: () => Promise.resolve({ private: 'member@example.test' }) as never,
    all: () =>
      error
        ? Promise.reject(error)
        : (Promise.resolve({
            results: [{ private: 'member@example.test' }],
            meta: { rows_read: 140, rows_written: 0, sql: 'private SQL' },
          }) as never),
    run: () => Promise.resolve({ meta: { changes: 1, rows_read: 3, rows_written: 2 } }),
  };
  return {
    prepare: () => statement,
    batch: () =>
      Promise.resolve([
        { meta: { rows_read: 7, rows_written: 1 } },
        { meta: { rows_read: 8, rows_written: 1 } },
      ]),
  };
}

void test('job telemetry measures D1 rows for first, all, run and batches without member data', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'log', (message: string) => logs.push(message));
  await runMeteredJob(database(), 'test_job', async (budget) => {
    assert.deepEqual(await budget.db.prepare('private SQL').first(), {
      private: 'member@example.test',
    });
    await budget.db.prepare('private SQL').all();
    await budget.db.prepare('private SQL').run();
    await budget.db.batch([budget.db.prepare('private SQL'), budget.db.prepare('private SQL')]);
    return { kind: 'complete' };
  });
  assert.deepEqual(
    logs.map((line) => JSON.parse(line) as unknown),
    [
      {
        event: 'job_database_usage',
        job: 'test_job',
        queries: 5,
        rows_read: 298,
        rows_written: 4,
        metadata_missing: 0,
        quota_exhausted: false,
      },
    ],
  );
  assert.ok(!logs.join('').includes('private'));
  assert.ok(!logs.join('').includes('member@'));
});

void test('quota exhaustion stops retry cleanup queries even when work catches the original error', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'log', (message: string) => logs.push(message));
  const db = database(
    new Error("D1_ERROR: Your account has exceeded D1's maximum daily rows read limit"),
  );
  let executions = 0;
  const original = db.prepare.bind(db);
  db.prepare = (sql) => {
    executions++;
    return original(sql);
  };
  await assert.rejects(
    runMeteredJob(db, 'test_job', async (budget) => {
      try {
        await budget.db.prepare('private SQL').all();
      } catch {
        /* The integration records retries. */
      }
      try {
        await budget.db.prepare('private SQL').run();
      } catch {
        /* A cleanup must not hide exhaustion. */
      }
      return { kind: 'retry' };
    }),
    /D1 account quota exhausted/,
  );
  assert.equal(executions, 1);
  assert.equal((JSON.parse(logs[0] ?? '{}') as { quota_exhausted: boolean }).quota_exhausted, true);
});

void test('a D1 quota error aborts later scheduled steps and produces only sanitized failure logs', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'log', (message: string) => logs.push(message));
  const visited: string[] = [];
  await assert.rejects(async () => {
    await scheduledStep('first', () =>
      runMeteredJob(
        database(
          new Error(
            "D1_ERROR: Your account has exceeded D1's maximum daily rows read limit; member@example.test",
          ),
        ),
        'first',
        async (budget) => {
          await budget.db.prepare('private SQL').all();
          return {};
        },
      ),
    );
    await scheduledStep('later', () => {
      visited.push('later');
      return Promise.resolve({});
    });
  }, /D1 account quota exhausted/);
  assert.deepEqual(visited, []);
  assert.ok(!logs.join('').includes('member@'));
});

void test('nested account quota failures stay fatal while bind errors remain ordinary failures', async (t) => {
  t.mock.method(console, 'log', () => undefined);
  const quota = new Error('D1 request failed', {
    cause: new Error("Your account has exceeded D1's free tier daily row write limit. [code:7500]"),
  });
  await assert.rejects(
    runMeteredJob(database(quota), 'nested', async (budget) => {
      await budget.db.prepare('private').all();
    }),
    /D1 account quota exhausted/,
  );
  const result = await scheduledStep('ordinary_failure', () =>
    runMeteredJob(
      database(new Error('D1_ERROR: Wrong number of parameter bindings for SQL query')),
      'binding',
      async (budget) => {
        await budget.db.prepare('private').all();
        return {};
      },
    ),
  );
  assert.equal(result, null);
});

void test('missing or invalid metadata is marked as unknown rather than accepted as usage', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'log', (message: string) => logs.push(message));
  const db = database();
  db.batch = () =>
    Promise.resolve([
      { meta: { rows_read: '123', rows_written: 1 } },
      { meta: { rows_read: -1, rows_written: Infinity } },
      { results: [] },
    ]);
  await runMeteredJob(db, 'unknown', async (budget) => {
    await budget.db.batch([
      budget.db.prepare('one'),
      budget.db.prepare('two'),
      budget.db.prepare('three'),
    ]);
  });
  assert.deepEqual(
    (JSON.parse(logs[0] ?? '{}') as { metadata_missing: number }).metadata_missing,
    3,
  );
});

void test('quota failures still abort scheduling when RPC preserves only the sanitized message', async (t) => {
  t.mock.method(console, 'log', () => undefined);
  await assert.rejects(
    scheduledStep('rpc_quota', () => Promise.reject(new Error('D1 account quota exhausted'))),
    /D1 account quota exhausted/,
  );
});
