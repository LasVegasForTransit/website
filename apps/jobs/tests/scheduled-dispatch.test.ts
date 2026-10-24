import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './support/scheduled-fixture';

void test('ordinary minutes skip record cleanup while privacy and member queues keep moving', async () => {
  const f = fixture(undefined, undefined, {
    scheduledTime: Date.parse('2026-10-19T20:37:00Z'),
    idleAccounts: true,
  });
  await f.run();
  assert.equal(f.visits.includes('records'), false);
  for (const name of [
    'profiles',
    'inactive_profiles',
    'newsletter_incoming',
    'discord_account',
    'newsletter_account',
    'completion',
  ])
    assert.ok(f.visits.includes(name), name);
});

void test('the scheduled UTC hour runs record cleanup even when dispatch arrives later', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-19T20:37:00Z'));
  const f = fixture(undefined, undefined, {
    scheduledTime: Date.parse('2026-10-19T20:00:00Z'),
    idleAccounts: true,
  });
  await f.run();
  assert.equal(f.visits.filter((name) => name === 'records').length, 1);
});

void test('daily privacy work starts at03:00 Pacific and remains inside the invocation allowance', async () => {
  for (const [time, expected] of [
    ['2026-10-14T09:59:00Z', false],
    ['2026-10-14T10:00:00Z', true],
  ] as const) {
    const f = fixture(undefined, undefined, { scheduledTime: Date.parse(time) });
    await f.run();
    assert.equal(f.visits.includes('inactive_profiles'), expected);
    assert.ok(f.visits.length + 1 <= 32);
    assert.equal(f.visits.at(-1), 'completion');
  }
});

void test('both busy providers get work within the 32-invocation request limit', async () => {
  const f = fixture();
  await f.run();
  assert.ok(f.visits.length + 1 <= 32, 'include the scheduled parent invocation');
  const discord = f.visits.filter((name) => name === 'discord_account').length;
  const newsletter = f.visits.filter((name) => name === 'newsletter_account').length;
  assert.ok(discord > 0 && newsletter > 0);
  assert.ok(Math.abs(discord - newsletter) <= 1);
  assert.equal(f.visits.at(-1), 'completion');
});
void test('ready newsletter choices are processed before any outgoing provider work', async () => {
  const f = fixture(undefined, undefined, { busyInbox: true });
  await f.run();
  assert.ok(f.visits.includes('newsletter_incoming'));
  for (const provider of ['discord', 'newsletter'])
    assert.ok(f.visits.indexOf('newsletter_incoming') < f.visits.indexOf(`${provider}_account`));
  assert.equal(f.visits.at(-1), 'completion');
});
void test('a large roster advances three pages while a busy inbox and both providers keep moving within the request limit', async () => {
  const f = fixture(undefined, undefined, { busyInbox: true, scanComplete: false });
  await f.run();
  assert.equal(f.visits.filter((name) => name === 'newsletter_scan').length, 3);
  assert.equal(f.visits.filter((name) => name === 'newsletter_incoming').length, 6);
  assert.ok(f.visits.length + 1 <= 32);
  const discord = f.visits.filter((name) => name === 'discord_account').length;
  const newsletter = f.visits.filter((name) => name === 'newsletter_account').length;
  assert.ok(discord > 0 && newsletter > 0);
  assert.ok(Math.abs(discord - newsletter) <= 1);
});
void test('a provider pause stops outgoing newsletter calls but still processes saved choices', async () => {
  const f = fixture(undefined, undefined, { busyInbox: true, paused: true });
  await f.run();
  assert.ok(f.visits.includes('newsletter_incoming'));
  assert.equal(f.visits.filter((name) => name === 'newsletter_account').length, 0);
  assert.ok(f.visits.includes('discord_account'));
  assert.equal(f.visits.at(-1), 'completion');
});
void test('incoming storage failure closes background work without outgoing effects', async () => {
  const f = fixture('newsletter_incoming');
  await assert.rejects(f.run(), /Scheduled (?:membership work failed|database work deferred)/);
  assert.equal(f.visits.includes('discord_account'), false);
  assert.equal(f.visits.includes('newsletter_account'), false);
  assert.equal(f.visits.at(-1), 'newsletter_incoming');
});
void test('slow account work stops new steps after the selection deadline and still completes', async (t) => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const f = fixture(undefined, (name) => {
    if (name.endsWith('_account')) clock += 30_000;
  });
  await f.run();
  assert.equal(f.visits.filter((name) => name.endsWith('_account')).length, 2);
  assert.equal(f.visits.at(-1), 'completion');
});
for (const provider of ['discord', 'newsletter']) {
  void test(`${provider} scan exceptions retain the reservation and stop remaining work`, async () => {
    const f = fixture(`${provider}_scan`);
    await assert.rejects(f.run(), /Scheduled (?:membership work failed|database work deferred)/);
    const other = provider === 'discord' ? 'newsletter' : 'discord';
    assert.equal(f.visits.includes(`${other}_account`), false);
    assert.equal(f.visits.at(-1), `${provider}_scan`);
  });
  void test(`${provider} account exceptions close the day before later provider effects`, async () => {
    const f = fixture(`${provider}_account`);
    await assert.rejects(f.run(), /Scheduled (?:membership work failed|database work deferred)/);
    const other = provider === 'discord' ? 'newsletter' : 'discord';
    assert.equal(f.visits.includes(`${other}_account`), provider === 'newsletter');
    assert.equal(f.visits.filter((name) => name === `${provider}_account`).length, 1);
    assert.equal(f.visits.at(-1), `${provider}_account`);
  });
}

void test('command RPC exceptions close background work without provider effects', async () => {
  const f = fixture('discord_commands');
  await assert.rejects(f.run(), /Scheduled (?:membership work failed|database work deferred)/);
  assert.equal(f.visits.includes('discord_scan'), false);
  assert.equal(f.visits.includes('discord_account'), false);
  assert.equal(f.visits.includes('newsletter_account'), false);
  assert.equal(f.visits.at(-1), 'discord_commands');
  assert.ok(f.visits.length + 1 <= 32);
});

void test('a failed registration result leaves both membership queues enabled', async () => {
  const f = fixture(undefined, undefined, { commandFailed: true });
  await assert.rejects(f.run(), /Scheduled (?:membership work failed|database work deferred)/);
  assert.ok(f.visits.includes('discord_account'));
  assert.ok(f.visits.includes('newsletter_account'));
  assert.equal(f.visits.at(-1), 'completion');
});
void test('disabled Discord synchronization never invokes command registration', async () => {
  const f = fixture(undefined, undefined, { discordDisabled: true });
  await f.run();
  assert.equal(f.visits.includes('discord_commands'), false);
  assert.equal(f.visits.includes('discord_account'), false);
  assert.ok(f.visits.includes('newsletter_account'));
});

void test('daily D1 quota exhaustion stops the invocation before any further maintenance or provider work', async () => {
  const f = fixture('records', undefined, {
    failureError: new Error(
      "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. [code:7500]",
    ),
  });
  await assert.rejects(f.run(), /D1 account quota exhausted/);
  assert.deepEqual(f.visits, ['records']);
});

void test('a quota-denied guard never invokes any scheduled RPC', async () => {
  const f = fixture(undefined, undefined, { guardDenied: true });
  await f.run();
  assert.deepEqual(f.visits, []);
});
void test('unverified metadata closes future cron invocations through UTC reset', async () => {
  const f = fixture(undefined, undefined, { missingUsage: true });
  await assert.rejects(f.run(), /Scheduled database work deferred/);
  assert.deepEqual(f.visits, ['records']);
  await f.run();
  assert.deepEqual(f.visits, ['records']);
});
void test('a spent measured reservation stops between RPCs and closes the daily ledger', async () => {
  const f = fixture(undefined, undefined, { rowsRead: 50_001 });
  await assert.rejects(f.run(), /Scheduled database work deferred/);
  assert.deepEqual(f.visits, ['records']);
  await f.run();
  assert.deepEqual(f.visits, ['records']);
});
void test('source scans and saved choices precede outgoing account changes', async () => {
  const f = fixture();
  await f.run();
  assert.ok(f.visits.indexOf('newsletter_incoming') < f.visits.indexOf('discord_account'));
  for (const provider of ['discord', 'newsletter']) {
    assert.ok(f.visits.indexOf('discord_scan') < f.visits.indexOf(`${provider}_account`));
    assert.ok(f.visits.indexOf('newsletter_scan') < f.visits.indexOf(`${provider}_account`));
    assert.ok(
      f.visits.indexOf('newsletter_poll_choices') < f.visits.indexOf(`${provider}_account`),
    );
  }
});

void test('a missing budget migration refuses background work before provider calls', async () => {
  const f = fixture();
  f.database.raw.exec('DROP TABLE scheduled_work_budget');
  await f.run();
  assert.deepEqual(f.visits, []);
});

void test('idle account queues are checked once while optional scans still run', async () => {
  const f = fixture(undefined, undefined, { idleAccounts: true });
  await f.run();
  assert.equal(f.visits.filter((name) => name === 'discord_account').length, 1);
  assert.equal(f.visits.filter((name) => name === 'newsletter_account').length, 1);
  assert.ok(f.visits.includes('discord_scan'));
  assert.ok(f.visits.includes('newsletter_scan'));
  assert.equal(f.visits.at(-1), 'completion');
});

void test('a quiet tick uses one statement without writes or child jobs', async () => {
  const f = fixture(undefined, undefined, { idleAccounts: true });
  await f.run();
  f.visits.length = 0;
  f.statements.count = 0;
  const before = f.database.raw.prepare('SELECT total_changes() AS n').get()?.n;
  await f.run();
  assert.deepEqual(f.visits, [], 'idle jobs must remain asleep');
  assert.equal(f.statements.count, 1, 'quiet ticks must only read the indexed schedule');
  assert.equal(f.database.raw.prepare('SELECT total_changes() AS n').get()?.n, before);
});

void test('missing control telemetry stops before acknowledging a group or running providers', async () => {
  const f = fixture(undefined, undefined, {
    idleAccounts: true,
    missingControlPattern: /AS pending/,
  });
  await assert.rejects(f.run(), /Missing scheduled database usage metadata/);
  assert.deepEqual(f.visits, ['records', 'profiles']);
  assert.equal(
    f.database.raw
      .prepare("SELECT configuration FROM scheduled_work_signals WHERE name='profiles'")
      .get()?.configuration,
    '',
  );
  assert.equal(
    f.database.raw.prepare('SELECT blocked FROM scheduled_work_budget').get()?.blocked,
    1,
  );
});
void test('blocked candidate pages cannot delay later due explicit work until a scan deadline', async () => {
  const { pendingDiscordOperations, outboxSelectionHasMore } =
    await import('@lasvegasfortransit/platform-storage/discord-pending');
  const f = fixture(undefined, undefined, { idleAccounts: true });
  f.database.raw.exec(`UPDATE integration_outbox SET state='done';
    WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<90)
    INSERT INTO people(id,membership_status,created_at,updated_at) SELECT printf('blocked-%04d',n),'member','2026-10-19','2026-10-19' FROM seq;
    INSERT INTO reconcile_generations(person_id,target_id,generation) SELECT id,'person',1 FROM people WHERE id LIKE 'blocked-%';
    INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      SELECT id,'person_reconcile',id,'person',1,'{"source":"committee.assign"}','2026-01-01','2026-01-01','2026-01-01' FROM people WHERE id LIKE 'blocked-%';
    INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
      VALUES('target','blocked-0090','discord','222222222222222222','2026-01-01','self_linked','2026-01-01','2026-01-01');`);
  const selected: string[] = [];
  let pages = 0;
  Object.assign(f.context.exports, {
    DiscordAccount: {
      run: async () => {
        pages++;
        const now = new Date('2026-10-19T20:00:00.000Z');
        const operations = await pendingDiscordOperations(f.database, now, 1);
        selected.push(...operations);
        for (const id of operations)
          f.database.raw
            .prepare(
              "INSERT INTO provider_operation_receipts(operation_id,provider,state,revision_hash,lease_token,observed_at,expires_at) VALUES(?,'discord','done','revision','lease',?,'2026-10-20T00:00:00.000Z') ON CONFLICT(operation_id,provider) DO UPDATE SET observed_at=excluded.observed_at",
            )
            .run(id, now.toISOString());
        return {
          selected: operations.length,
          paused: false,
          failed: false,
          more: await outboxSelectionHasMore(f.database, 'discord'),
          databaseUsage: {
            rows_read: 1,
            rows_written: 1,
            metadata_missing: 0,
            database_errors: 0,
            quota_exhausted: false,
          },
        };
      },
    },
  });
  await f.run();
  assert.deepEqual(selected, ['blocked-0090']);
  assert.ok(pages >= 6 && pages <= 20, `bounded page progress: ${pages}`);
});

void test('an incoming withdrawal eligible after cron start runs before outgoing accounts', async (t) => {
  const start = Date.parse('2026-10-19T20:37:00.000Z');
  t.mock.method(Date, 'now', () => start + 2);
  const f = fixture(undefined, undefined, { scheduledTime: start, idleAccounts: true });
  f.database.raw.exec(`
    UPDATE newsletter_inbound_events SET occurred_at='2026-10-19T20:37:00.001Z';
    UPDATE beehiiv_poll_checkpoints SET next_scan_at='2026-10-20T20:00:00.000Z';
    INSERT INTO provider_scan_checkpoints(provider,context_id,started_at,next_scan_at,in_progress)
      VALUES('discord','111111111111111111','2026-10-19','2026-10-20',0),
      ('discord','guild-roster:111111111111111111','2026-10-19','2026-10-20',0);
  `);
  await f.run();
  assert.equal(f.visits.includes('discord_scan'), false);
  assert.equal(f.visits.includes('newsletter_scan'), false);
  assert.ok(f.visits.includes('newsletter_incoming'));
  for (const provider of ['discord', 'newsletter']) {
    assert.ok(f.visits.includes(`${provider}_account`));
    assert.ok(f.visits.indexOf('newsletter_incoming') < f.visits.indexOf(`${provider}_account`));
  }
});

void test('task check-ins advance independently of role sync without starving membership or exceeding the invocation budget', async () => {
  const f = fixture(undefined, undefined, {
    taskCheckins: true,
    discordDisabled: true,
    busyInbox: true,
  });
  await f.run();
  for (const step of [
    'task_commands',
    'task_scan',
    'task_queue',
    'task_operation',
    'task_digest',
    'task_refresh',
    'task_recovery',
    'task_escalation',
  ])
    assert.ok(f.visits.includes(step), step);
  assert.ok(f.visits.indexOf('newsletter_account') < f.visits.indexOf('task_scan'));
  assert.ok(f.visits.length + 1 <= 32);
  assert.equal(f.visits.at(-1), 'completion');
});
void test('a reported task failure with usage still allows other steps and completion', async () => {
  const f = fixture(undefined, undefined, { taskCheckins: true, failedTaskOutcome: true });
  await assert.rejects(f.run(), /Scheduled membership work failed/);
  assert.ok(f.visits.includes('task_operation'));
  assert.ok(f.visits.includes('discord_account'));
  assert.equal(f.visits.at(-1), 'completion');
});
void test('missing task usage retains the reservation and stops unaccounted work', async () => {
  const f = fixture('task_scan', undefined, { taskCheckins: true });
  await assert.rejects(f.run(), /Scheduled database work deferred/);
  assert.equal(f.visits.includes('task_operation'), false);
});
