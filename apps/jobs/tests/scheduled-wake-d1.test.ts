import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { runMaintenance } from '@lasvegasfortransit/platform-storage/retention';
import { queueDiscordDrift } from '@lasvegasfortransit/platform-storage/discord-drift';
import { completeProviderOperations } from '@lasvegasfortransit/platform-storage/provider-completion';
import { pendingNewsletterSources } from '@lasvegasfortransit/platform-storage/newsletter-source-queue';
import { pendingNewsletterPeople } from '@lasvegasfortransit/platform-storage/newsletter-sync-store';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { pollBeehiivRoster } from '@lasvegasfortransit/platform-integrations/beehiiv-poll';
import { processNewsletterSourceEvents } from '@lasvegasfortransit/platform-integrations/newsletter-source-processor';
import { scanDiscordGuildRoster } from '@lasvegasfortransit/platform-integrations/discord-roster';
import { reconcileDiscordPending } from '@lasvegasfortransit/platform-integrations/discord-runner';
import { runDiscordCommandRegistration } from '@lasvegasfortransit/platform-integrations/discord-command-registration';
import { LINK_COMMAND } from '@lasvegasfortransit/platform-integrations/discord-link-command';
import { runScheduledMembership } from '../src/scheduled';
import { runMeteredJob } from '../src/job-database';

void test('a real D1 idle hour stays bounded with both providers and 100000 synthetic profiles', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'log', (line: string) => logs.push(line));

  const data = await mkdtemp(join(tmpdir(), 'lvbt-wake-hour-'));
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: '2026-09-04',
      resourcePersistencePath: data,
      d1Databases: { PLATFORM_DB: 'wake' },
      cf: false,
    }),
  );
  t.after(async () => {
    await mf.dispose();
    await rm(data, { recursive: true, force: true });
  });
  const database = await mf.getD1Database('PLATFORM_DB');
  await database.prepare('SELECT 1').first();
  const file = (await readdir(data, { recursive: true })).find(
    (name) => name.includes('d1') && name.endsWith('.sqlite'),
  );
  assert.ok(file);
  const raw = new DatabaseSync(join(data, file));
  applyMigrations(raw);
  raw.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<100000)
    INSERT INTO people(id,given_name,created_at,updated_at) SELECT 'unrelated-'||n,'Private','2026-10-20T00:00:00.000Z','2026-10-20T00:00:00.000Z' FROM seq`);
  raw.exec(`INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at,lease_token,lease_expires_at)
    SELECT id,1,'running','2026-10-20T00:00:00.000Z','2026-10-20T00:00:00.000Z','held','2026-10-21T00:00:00.000Z' FROM people;
    WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<10000)
    INSERT INTO newsletter_inbound_events(publication_id,id,type,subscription_id,email_key,fingerprint,occurred_at,received_at)
      SELECT 'pub_preview','future-'||n,'subscription.deleted','sub-'||n,'opaque','hash','2026-10-21T00:00:00.000Z','2026-10-20T00:00:00.000Z' FROM seq;`);
  raw.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<60)
    INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,state,next_attempt_at,created_at,updated_at)
      SELECT 'historical-'||n,'person_reconcile','unrelated-'||n,'person',1,'{}','done','2026-10-20','2026-10-20','2026-10-20' FROM seq;
    WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<60)
    INSERT INTO provider_operation_receipts(operation_id,provider,state,revision_hash,lease_token,observed_at,expires_at)
      SELECT 'historical-'||n,'discord','done','revision','lease','2026-10-20T12:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','2026-10-20T12:00:00Z','+'||n||' minutes') FROM seq;`);
  raw.close();
  let now = new Date('2026-10-20T12:00:00.000Z');
  t.mock.method(Date, 'now', () => now.getTime());
  const guildId = '111111111111111111',
    applicationId = '555555555555555555',
    memberRoleId = '333333333333333333',
    publicationId = 'pub_preview',
    intentKey = 'a'.repeat(43);
  const discord = {
    configuration: {
      environment: 'preview' as const,
      guildId,
      productionGuildId: '999999999999999999',
      botToken: 'fixture-only',
    },
    applicationId,
    memberRoleId,
  };
  let meter = queryBudget(database, 1000, { measureRows: true, strictRows: true });
  let visits = 0;
  let costs: Record<
    string,
    { calls: number; queries: number; rows_read: number; rows_written: number }
  > = {};
  const job = <T extends object>(name: string, run: (db: Db) => Promise<T>) => ({
    run: async () => {
      visits++;
      const before = meter.usage;
      try {
        return await runMeteredJob(meter.db, name, (b) => run(b.db));
      } finally {
        const entry = (costs[name] ??= { calls: 0, queries: 0, rows_read: 0, rows_written: 0 });
        entry.calls++;
        for (const key of ['queries', 'rows_read', 'rows_written'] as const)
          entry[key] += meter.usage[key] - before[key];
      }
    },
  });
  const exports = {
    StaffMaintenance: job('records', (db) => runMaintenance(db, { now, category: 'records' })),
    ProfileMaintenance: job('profiles', (db) => runMaintenance(db, { now, category: 'profiles' })),
    InactiveProfileMaintenance: job('inactive', (db) =>
      runMaintenance(db, { now, category: 'inactive' }),
    ),
    ProviderCompletion: job('completion', async (db) => ({
      completed: await completeProviderOperations(db, { now }),
    })),
    DiscordCommands: job('commands', (db) =>
      runDiscordCommandRegistration(db, {
        applicationId,
        guildId,
        botToken: 'fixture-only',
        now: () => now,
        fetcher: () =>
          Promise.resolve(Response.json([{ ...LINK_COMMAND, id: '444444444444444444' }])),
      }),
    ),
    DiscordScan: job('discord_scan', async (db) => ({
      drift: await queueDiscordDrift(db, { guildId, now: () => now }),
      roster: await scanDiscordGuildRoster(db, {
        client: { configuration: { guildId }, listGuildMembers: () => Promise.resolve([]) },
        memberRoleId,
        now: () => now,
      }),
    })),
    NewsletterScan: job('newsletter_scan', (db) =>
      pollBeehiivRoster(
        db,
        { publicationId, apiKey: 'fixture-only' },
        {
          now: () => now,
          fetcher: () =>
            Promise.resolve(Response.json({ data: [], has_more: false, next_cursor: null })),
        },
      ),
    ),
    NewsletterIncoming: job('incoming', (db) =>
      processNewsletterSourceEvents(db, { publicationId, intentKey, now }),
    ),
    NewsletterPollingChoices: job('choices', (db) =>
      new PersonService(db).processNewsletterPollChoices({
        publicationId,
        policy: 'keep_unsubscribed',
        now,
      }),
    ),
    DiscordAccount: job('discord_account', async (db) => ({
      ...(await reconcileDiscordPending(db, {
        ...discord,
        limit: 1,
        changeLimit: 1,
        now: () => now,
        fetch: () => {
          throw new Error('Idle accounts must not call Discord');
        },
      })),
      failed: false,
    })),
    NewsletterAccount: job('newsletter_account', async (db) => {
      assert.deepEqual(await pendingNewsletterPeople(db, now, 1), []);
      return { kind: 'idle', paused: false };
    }),
  };
  const context = { exports } as unknown as ExecutionContext;
  const env = {
    PLATFORM_DB: meter.db,
    LVBT_DEPLOYMENT_ENV: 'preview',
    LVBT_DISCORD_SYNC_ENABLED: 'true',
    LVBT_DISCORD_APPLICATION_ID: applicationId,
    LVBT_DISCORD_GUILD_ID: guildId,
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
    LVBT_DISCORD_MEMBER_ROLE_ID: memberRoleId,
    LVBT_DISCORD_BOT_TOKEN: 'fixture-only',
    LVBT_BEEHIIV_SYNC_ENABLED: 'true',
    LVBT_BEEHIIV_PUBLICATION_ID: publicationId,
    LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID: 'pub_production',
    LVBT_BEEHIIV_API_KEY: 'fixture-only',
    LVBT_NEWSLETTER_INTENT_KEY: intentKey,
    LVBT_BEEHIIV_CONFLICT_POLICY: 'keep_unsubscribed',
  } as unknown as Env;
  const tick = async () => {
    env.PLATFORM_DB = meter.db as unknown as D1Database;
    await runScheduledMembership(
      { scheduledTime: now.getTime() } as ScheduledController,
      env,
      context,
    );
  };
  await tick();
  costs = {};
  let quietMinutes = 0;
  meter = queryBudget(database, 1000, { measureRows: true, strictRows: true });
  for (let minute = 1; minute <= 60; minute++) {
    now = new Date(Date.parse('2026-10-20T12:00:00.000Z') + minute * 60_000);
    const next = await database
      .prepare('SELECT min(next_run_at) AS due FROM scheduled_work_signals')
      .first<{ due: string }>();
    const quiet = Boolean(next && next.due > now.toISOString());
    const before = { queries: meter.queries, writes: meter.usage.rows_written, visits };
    await tick();
    if (quiet) {
      quietMinutes++;
      assert.equal(visits, before.visits);
      assert.equal(meter.queries - before.queries, 1);
      assert.equal(meter.usage.rows_written - before.writes, 0);
    }
  }
  assert.ok(quietMinutes >= 50, `quiet minutes: ${quietMinutes}`);
  assert.ok(meter.queries <= 200, `issued SQL: ${meter.queries}`);
  assert.ok(meter.usage.rows_read <= 1100, `billed rows read: ${meter.usage.rows_read}`);
  assert.ok(meter.usage.rows_written <= 100, `billed rows written: ${meter.usage.rows_written}`);
  assert.equal(meter.usage.metadata_missing, 0);
  t.diagnostic(JSON.stringify({ quietMinutes, ...meter.usage, jobs: costs }));
  now = new Date('2026-10-20T13:01:00.000Z');
  await database
    .prepare("INSERT INTO provider_backoffs VALUES('discord',?,'2026-10-20T13:31:00.000Z',1,?)")
    .bind(applicationId, now.toISOString())
    .run();
  await database
    .prepare("INSERT INTO newsletter_provider_backoffs VALUES(?,'2026-10-20T13:31:00.000Z')")
    .bind(publicationId)
    .run();
  await database
    .prepare(
      "UPDATE provider_scan_checkpoints SET next_scan_at='2026-10-20T13:00:00.000Z',in_progress=1 WHERE context_id=?",
    )
    .bind(`guild-roster:${guildId}`)
    .run();
  const checkpoint = await database
    .prepare('SELECT * FROM provider_scan_checkpoints ORDER BY context_id')
    .all();
  await tick();
  for (const time of ['2026-10-20T13:02:00.000Z', '2026-10-20T13:03:00.000Z']) {
    now = new Date(time);
    const before = { queries: meter.queries, writes: meter.usage.rows_written, visits };
    await tick();
    assert.equal(meter.queries - before.queries, 1, 'a held backoff must remain quiet');
    assert.equal(meter.usage.rows_written, before.writes);
    assert.equal(visits, before.visits);
  }
  assert.deepEqual(
    (await database.prepare('SELECT * FROM provider_scan_checkpoints ORDER BY context_id').all())
      .results,
    checkpoint.results,
  );
  await database
    .prepare(
      `INSERT INTO newsletter_inbound_events(publication_id,id,type,subscription_id,email_key,fingerprint,occurred_at,received_at)
    VALUES('pub_preview','due-event','subscription.deleted','due-sub','opaque','hash','2026-10-20T12:00:00.000Z','2026-10-20T12:00:00.000Z')`,
    )
    .run();
  const inbox = queryBudget(database, 10, { measureRows: true, strictRows: true });
  assert.equal((await pendingNewsletterSources(inbox.db, publicationId, now, 25)).length, 1);
  assert.ok(
    inbox.usage.rows_read <= 100,
    `one due event among10000future events read ${inbox.usage.rows_read} rows`,
  );
});
