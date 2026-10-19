import { queueDiscordDrift } from '@lasvegasfortransit/platform-storage/discord-drift';
import { scanDiscordGuildRoster } from '@lasvegasfortransit/platform-integrations/discord-roster';
import { runDiscordCommandRegistration } from '@lasvegasfortransit/platform-integrations/discord-command-registration';
import { LINK_COMMAND } from '@lasvegasfortransit/platform-integrations/discord-link-command';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { completeProviderOperations } from '@lasvegasfortransit/platform-storage/provider-completion';
import { reconcileDiscordPending } from '@lasvegasfortransit/platform-integrations/discord-runner';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { runMaintenance } from '@lasvegasfortransit/platform-storage/retention';
import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  queryBudget,
  SCHEDULED_RESERVATION,
  SCHEDULED_CONTROL_ALLOWANCE,
  reserveScheduledWork,
  settleScheduledWork,
} from '@lasvegasfortransit/platform-storage/query-budget';

void test('real D1 singleton guard and settlement fit their charged control allowance', async (t) => {
  const logs: {
    event: string;
    rows_read: number;
    rows_written: number;
    metadata_missing: number;
  }[] = [];
  t.mock.method(console, 'log', (line: string) =>
    logs.push(JSON.parse(line) as (typeof logs)[number]),
  );
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: '2026-09-04',
      d1Databases: ['budget'],
      cf: false,
    }),
  );
  try {
    const db = await mf.getD1Database('budget');
    await db.exec(
      readFileSync(
        new URL(
          '../../../packages/platform-storage/migrations/0051_scheduled_work_budget.sql',
          import.meta.url,
        ),
        'utf8',
      ).replace(/\n/g, ' '),
    );
    const now = new Date('2026-10-19T12:00:00Z');
    const lease = await reserveScheduledWork(db, 'production', now, 'real');
    assert.ok(lease);
    await settleScheduledWork(
      db,
      lease,
      {
        rows_read: 20,
        rows_written: 2,
        metadata_missing: 0,
        database_errors: 0,
        quota_exhausted: false,
      },
      { failed: false, now },
    );
    assert.equal(logs.length, 3);
    for (const record of logs) {
      assert.equal(record.metadata_missing, 0);
      assert.ok(record.rows_read <= 4 && record.rows_written <= 4);
    }
    const controls = logs.filter((record) => record.event !== 'scheduled_budget_guard');
    assert.ok(
      controls.reduce((sum, record) => sum + record.rows_read, 0) <=
        SCHEDULED_CONTROL_ALLOWANCE.reads,
    );
    assert.ok(
      controls.reduce((sum, record) => sum + record.rows_written, 0) <=
        SCHEDULED_CONTROL_ALLOWANCE.writes,
    );
    assert.equal(
      (
        await db
          .prepare('SELECT charged_reads FROM scheduled_work_budget')
          .first<{ charged_reads: number }>()
      )?.charged_reads,
      20 + lease.guardReads + SCHEDULED_CONTROL_ALLOWANCE.reads,
    );
  } finally {
    await mf.dispose();
  }
});

void test('a supported hundred-profile erasure batch fits the invocation reservation', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'lvbt-guard-batch-'));
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: '2026-09-04',
      resourcePersistencePath: data,
      d1Databases: { PLATFORM_DB: 'batch' },
      cf: false,
    }),
  );
  t.after(async () => {
    await mf.dispose();
    await rm(data, { recursive: true, force: true });
  });
  const db = await mf.getD1Database('PLATFORM_DB');
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
  const now = new Date('2026-10-18T12:00:00Z');
  const guildId = '111111111111111111';
  const applicationId = '555555555555555555';
  const memberRoleId = '333333333333333333';
  const commandKey = `command-link:${applicationId}:${guildId}:${await digestToken(JSON.stringify(LINK_COMMAND))}`;
  for (const context of [guildId, `guild-roster:${guildId}`, commandKey])
    await db
      .prepare(
        `INSERT INTO provider_scan_checkpoints(provider,context_id,started_at,next_scan_at,in_progress,last_completed_at)
      VALUES('discord',?,?,'2026-10-18T13:00:00Z',0,?)`,
      )
      .bind(context, now.toISOString(), now.toISOString())
      .run();
  async function idlePass(token: string) {
    const idle = queryBudget(db, 50, { measureRows: true });
    const lease = await reserveScheduledWork(db, 'production', now, token);
    assert.ok(lease);
    await runMaintenance(idle.db, { now, category: 'records' });
    await runMaintenance(idle.db, { now, category: 'profiles' });
    const optional = queryBudget(db, 50, { measureRows: true });
    await runDiscordCommandRegistration(optional.db, {
      applicationId,
      guildId,
      botToken: 'fixture-only',
      now: () => now,
    });
    await queueDiscordDrift(optional.db, { guildId, now: () => now });
    await scanDiscordGuildRoster(optional.db, {
      client: {
        configuration: { guildId },
        listGuildMembers: () => {
          throw new Error('Idle scans must not call Discord');
        },
      },
      memberRoleId,
      now: () => now,
    });
    assert.equal(
      optional.usage.rows_written,
      0,
      'completed commands and not-due scans add no idle writes',
    );
    await reconcileDiscordPending(idle.db, {
      configuration: {
        environment: 'preview',
        guildId,
        productionGuildId: '999999999999999999',
        botToken: 'fixture-only',
      },
      applicationId,
      memberRoleId,
      limit: 1,
      changeLimit: 1,
      now: () => now,
      fetch: () => {
        throw new Error('Idle work must not call Discord');
      },
    });
    await completeProviderOperations(idle.db, { now });
    await settleScheduledWork(
      db,
      lease,
      { ...idle.usage, rows_read: idle.usage.rows_read + optional.usage.rows_read },
      { failed: false, now },
    );
    return idle.usage;
  }
  await idlePass('cold');
  const coldCharge = await db
    .prepare('SELECT charged_writes FROM scheduled_work_budget')
    .first<{ charged_writes: number }>();
  assert.ok(coldCharge);
  const idle = await idlePass('steady');
  const nextCharge = await db
    .prepare('SELECT charged_writes FROM scheduled_work_budget')
    .first<{ charged_writes: number }>();
  assert.ok(nextCharge);
  const steadyChargedWrites = nextCharge.charged_writes - coldCharge.charged_writes;
  await db
    .prepare(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<100)
    INSERT INTO people(id,given_name,email,created_at,updated_at,deleted_at)
    SELECT 'due-'||n,'Private', 'due-'||n||'@example.invalid','2020-01-01','2020-01-01','2026-09-18T12:00:00Z' FROM seq`,
    )
    .run();
  const budget = queryBudget(db, 50, { measureRows: true });
  const result = await runMaintenance(budget.db, {
    now: new Date('2026-10-18T12:00:00Z'),
    category: 'profiles',
  });
  assert.equal(result.profilesErased, 100);
  assert.equal(budget.usage.metadata_missing, 0);
  assert.ok(
    budget.usage.rows_written > 200 && budget.usage.rows_written < SCHEDULED_RESERVATION.writes,
  );
  assert.ok(budget.usage.rows_read < SCHEDULED_RESERVATION.reads);
  const projectedWrites =
    coldCharge.charged_writes + steadyChargedWrites * 1_439 + budget.usage.rows_written * 10;
  assert.ok(
    projectedWrites <= 40_000,
    `idle ticks plus 1,000 due profiles charge ${projectedWrites} writes per day`,
  );
  t.diagnostic(
    JSON.stringify({
      ...budget.usage,
      idleWrites: idle.rows_written,
      coldChargedWrites: coldCharge.charged_writes,
      steadyChargedWrites,
      projectedWrites,
    }),
  );
});
