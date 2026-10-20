import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import type { Db, Statement } from '@lasvegasfortransit/platform-storage/db';
import { runScheduledMembership } from '../../src/scheduled';

export function fixture(
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
    missingControlPattern?: RegExp;
  } = {},
) {
  const native = memoryDb();
  const statements = { count: 0 };
  const wrap = (statement: Statement, sql: string): Statement => ({
    bind: (...values) => wrap(statement.bind(...values), sql),
    first: () => {
      statements.count++;
      return statement.first();
    },
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors D1 row typing
    all: async <T>() => {
      statements.count++;
      return {
        ...(await statement.all<T>()),
        meta: options.missingControlPattern?.test(sql) ? {} : { rows_read: 1, rows_written: 1 },
      };
    },
    run: async () => {
      statements.count++;
      const result = await statement.run();
      return { ...result, meta: { ...result.meta, rows_read: 1, rows_written: 1 } };
    },
  });
  const database: Db = {
    prepare: (sql) => wrap(native.prepare(sql), sql),
    batch: (statements) => native.batch(statements),
  };
  const visits: string[] = [];
  const step = (name: string, result: object) => ({
    run: () => {
      visits.push(name);
      if (name === 'newsletter_incoming')
        native.raw.exec("UPDATE newsletter_inbound_events SET state='ignored'");
      if (name === 'newsletter_poll_choices')
        native.raw.exec("UPDATE newsletter_poll_choices SET state='ignored'");
      if (name === 'completion') native.raw.exec("UPDATE integration_outbox SET state='done'");
      if (name === 'newsletter_account' && options.idleAccounts)
        native.raw.exec("UPDATE newsletter_sync_jobs SET state='done'");
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
  native.raw.exec(`
    INSERT INTO people(id,given_name,created_at,updated_at) VALUES('dispatch-person','Private','2026-10-20','2026-10-20');
    INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,created_at,updated_at,next_attempt_at)
      VALUES('dispatch-operation','person_reconcile','dispatch-person','person',1,'{}','2026-01-01','2026-01-01','2026-01-01');
    INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at)
      VALUES('dispatch-person',1,'queued','2026-01-01','2026-01-01');
    INSERT INTO newsletter_inbound_events(publication_id,id,type,subscription_id,email_key,fingerprint,occurred_at,received_at,state)
      VALUES('pub_preview','event','subscription.deleted','subscription','opaque','hash','2026-01-01','2026-01-01','pending');
    INSERT INTO beehiiv_poll_checkpoints(publication_id,started_at,next_scan_at,next_attempt_at,in_progress)
      VALUES('pub_preview','2026-01-01','2026-01-01','2026-01-01',0);
    INSERT INTO beehiiv_subscription_observations VALUES('pub_preview','subscription','inactive','2026-01-01','2026-01-01','2026-01-01');
    INSERT INTO newsletter_poll_choices(publication_id,subscription_id,revision,status,observed_at,last_seen_at,state)
      VALUES('pub_preview','subscription',1,'inactive','2026-01-01','2026-01-01','pending');
  `);
  const controller = {
    scheduledTime: options.scheduledTime ?? Date.parse('2026-10-19T20:00:00Z'),
  } as ScheduledController;
  return {
    visits,
    context,
    statements,
    database: native,
    run: () => runScheduledMembership(controller, env, context),
  };
}
