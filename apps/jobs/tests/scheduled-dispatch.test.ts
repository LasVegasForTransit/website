import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import type { Db, Statement } from '@lasvegasfortransit/platform-storage/db';
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScheduledMembership } from '../src/scheduled';

function fixture(
  failedStep?: string,
  onStep?: (name: string) => void,
  options: {
    busyInbox?: boolean;
    scanComplete?: boolean;
    paused?: boolean;
    scheduledTime?: number;
    commandFailed?: boolean;
    discordDisabled?: boolean;
    failureError?: Error;
    missingUsage?: boolean;
    guardDenied?: boolean;
    rowsRead?: number;
    idleAccounts?: boolean;
  } = {},
) {
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
  const database: Db = {
    prepare: (sql) => wrap(native.prepare(sql)),
    batch: (statements) => native.batch(statements),
  };
  const visits: string[] = [];
  const step = (name: string, result: object) => ({
    run: () => {
      visits.push(name);
      onStep?.(name);
      return name === failedStep
        ? Promise.reject(
            options.failureError ?? new Error('private provider error must not be logged'),
          )
        : Promise.resolve({
            ...result,
            databaseUsage: {
              rows_read: options.rowsRead ?? 1,
              rows_written: 1,
              metadata_missing: options.missingUsage ? 1 : 0,
              database_errors: 0,
              quota_exhausted: false,
            },
          });
    },
  });
  const context = {
    exports: {
      StaffMaintenance: step('records', {}),
      ProfileMaintenance: step('profiles', {}),
      InactiveProfileMaintenance: step('inactive_profiles', {}),
      ProviderCompletion: step('completion', {}),
      DiscordCommands: step('discord_commands', {
        kind: options.commandFailed ? 'failed' : 'complete',
      }),
      DiscordScan: step('discord_scan', {}),
      NewsletterScan: step('newsletter_scan', {
        kind: options.paused ? 'paused' : 'scanned',
        complete: options.scanComplete ?? true,
      }),
      NewsletterIncoming: step('newsletter_incoming', {
        kind: options.busyInbox ? 'progress' : 'idle',
        more: options.busyInbox ?? false,
      }),
      NewsletterPollingChoices: step('newsletter_poll_choices', { kind: 'idle', more: false }),
      DiscordAccount: step('discord_account', {
        selected: options.idleAccounts ? 0 : 1,
        failed: false,
        paused: false,
      }),
      NewsletterAccount: step('newsletter_account', {
        kind: options.idleAccounts ? 'idle' : 'progress',
        paused: false,
      }),
    },
  } as unknown as ExecutionContext;
  if (options.guardDenied)
    database.prepare = () => {
      throw new Error("Your account has exceeded D1's free tier daily row read limit");
    };
  const env = {
    PLATFORM_DB: database,
    LVBT_DEPLOYMENT_ENV: 'preview',
    LVBT_DISCORD_SYNC_ENABLED: options.discordDisabled ? 'false' : 'true',
    LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
    LVBT_DISCORD_GUILD_ID: '111111111111111111',
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
    LVBT_DISCORD_MEMBER_ROLE_ID: '333333333333333333',
    LVBT_DISCORD_BOT_TOKEN: 'fixture-only',
    LVBT_BEEHIIV_SYNC_ENABLED: 'true',
    LVBT_BEEHIIV_PUBLICATION_ID: 'pub_preview',
    LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID: 'pub_production',
    LVBT_BEEHIIV_API_KEY: 'fixture-only',
    LVBT_NEWSLETTER_INTENT_KEY: 'a'.repeat(43),
    LVBT_BEEHIIV_WEBHOOK_SECRET: `whsec_${btoa('fixture-event-key-only')}`,
  } as unknown as Env;
  const controller = {
    scheduledTime: options.scheduledTime ?? Date.parse('2026-10-19T20:00:00Z'),
  } as ScheduledController;
  return { visits, database: native, run: () => runScheduledMembership(controller, env, context) };
}
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
void test('a large roster advances five pages while a busy inbox and both providers keep moving within the request limit', async () => {
  const f = fixture(undefined, undefined, { busyInbox: true, scanComplete: false });
  await f.run();
  assert.equal(f.visits.filter((name) => name === 'newsletter_scan').length, 5);
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
  assert.equal(f.visits.filter((name) => name === 'newsletter_account').length, 1);
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
    assert.equal(f.visits.includes(`${other}_account`), true);
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
void test('current member choices and first account work run ahead of optional roster scans', async () => {
  const f = fixture();
  await f.run();
  assert.ok(f.visits.indexOf('newsletter_incoming') < f.visits.indexOf('discord_account'));
  assert.ok(f.visits.indexOf('discord_account') < f.visits.indexOf('discord_scan'));
  assert.ok(f.visits.indexOf('newsletter_account') < f.visits.indexOf('newsletter_scan'));
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
