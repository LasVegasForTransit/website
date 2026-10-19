import assert from 'node:assert/strict';
import type { Db } from '@lasvegasfortransit/platform-storage/db';

export async function assertBudgetMissing(
  worker: { scheduled(options: { cron: string }): Promise<{ outcome: string }> },
  calls: string[],
  commands: string[],
): Promise<void> {
  assert.equal((await worker.scheduled({ cron: '* * * * *' })).outcome, 'ok');
  assert.deepEqual(calls, [], 'missing budget table must refuse provider work');
  assert.deepEqual(commands, []);
}

export async function assertBudgetUsage(db: Db): Promise<void> {
  const ledger = await db
    .prepare('SELECT charged_reads,charged_writes,blocked FROM scheduled_work_budget')
    .first<{ charged_reads: number; charged_writes: number; blocked: number }>();
  assert.ok(ledger && ledger.charged_reads > 0 && ledger.charged_reads < 50_000);
  assert.ok(ledger.charged_writes > 0 && ledger.charged_writes < 2_000);
  assert.equal(ledger.blocked, 0, 'compiled RPC telemetry must permit verified usage settlement');
}

export async function assertDeletionEvidence(db: Db): Promise<void> {
  assert.equal((await db.prepare('SELECT count(*) AS n FROM discord_profiles').first())?.n, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM access_observations').first())?.n, 0);
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM provider_access_intents').first())?.n,
    0,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM staff_audits WHERE action='access.revoked' AND json_extract(details,'$.source')='person_deleted'",
        )
        .first()
    )?.n,
    3,
    'deletion needs confirmed cleanup evidence for each removed role',
  );
}
