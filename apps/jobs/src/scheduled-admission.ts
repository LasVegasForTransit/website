import { workLinkRuntime } from '@lasvegasfortransit/platform-integrations/discord-work-runtime';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { LINK_COMMAND } from '@lasvegasfortransit/platform-integrations/discord-link-command';
import { taskCheckinWorkerRuntime } from '@lasvegasfortransit/platform-integrations/notion-task-runtime';
import {
  discordRuntime,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';
import {
  beehiivRuntime,
  type BeehiivRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/beehiiv-runtime';
import {
  dueScheduledSignals,
  type ScheduledSignal,
  type ProviderSchedule,
} from '@lasvegasfortransit/platform-storage/scheduled-wake';
import {
  queryBudget,
  reserveScheduledWork,
  settleScheduledWork,
  SCHEDULED_CONTROL_ALLOWANCE,
  isD1QuotaExceeded,
  type ScheduledWorkLease,
} from '@lasvegasfortransit/platform-storage/query-budget';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  emptyScheduledUsage,
  ScheduledWorkDeferred,
  type ScheduledBudget,
} from './scheduled-budget';

type ScheduledEnv = Env & DiscordRuntimeEnv & BeehiivRuntimeEnv;
export interface ScheduledAdmission {
  signals: ScheduledSignal[];
  configuration: string;
  providers: ProviderSchedule;
  db: Db;
  budget: ScheduledBudget;
  taskCheckins: boolean;
  discordWork?: boolean;
}
function deferred(reason: string) {
  console.log(JSON.stringify({ event: 'scheduled_work_deferred', reason }));
}
async function configurationFor(env: ScheduledEnv) {
  const discord = discordRuntime(env),
    newsletter = beehiivRuntime(env),
    tasks = taskCheckinWorkerRuntime(env, true);
  const work = workLinkRuntime(env);
  const digest = await digestToken(JSON.stringify(LINK_COMMAND));
  const providers = {
    guildId: discord?.configuration.guildId ?? null,
    applicationId: discord?.applicationId ?? null,
    publicationId: newsletter?.configuration.publicationId ?? null,
    commandContext: discord
      ? `command-link:${discord.applicationId}:${discord.configuration.guildId}:${digest}`
      : null,
  };
  return {
    providers,
    taskCheckins: Boolean(tasks),
    discordWork: Boolean(work),
    configuration: JSON.stringify([
      providers,
      discord?.memberRoleId,
      env.LVBT_BEEHIIV_CONFLICT_POLICY,
      tasks
        ? [
            tasks.sourceId,
            tasks.applicationId,
            tasks.guildId,
            env.LVBT_TASK_CHECKINS_ENABLED,
            env.LVBT_TASK_UPDATES_ENABLED,
          ]
        : null,
      work ? [work.sourceId, work.applicationId, work.guildId] : null,
    ]),
  };
}
async function reserve(env: ScheduledEnv) {
  try {
    const lease = await reserveScheduledWork(
      env.PLATFORM_DB,
      env.LVBT_DEPLOYMENT_ENV,
      new Date(),
      crypto.randomUUID(),
    );
    if (!lease) deferred('budget_closed_or_leased');
    return lease;
  } catch (error) {
    deferred(isD1QuotaExceeded(error) ? 'account_quota' : 'guard_unavailable');
    return null;
  }
}
function accountControls(budget: ScheduledBudget, control: ReturnType<typeof queryBudget>) {
  const usage = control.usage;
  budget.usage.rows_read += usage.rows_read;
  budget.usage.rows_written += usage.rows_written;
  budget.usage.metadata_missing += usage.metadata_missing;
  budget.usage.database_errors += usage.database_errors;
  budget.usage.quota_exhausted ||= usage.quota_exhausted;
}
async function executeAdmission(
  env: ScheduledEnv,
  state: {
    control: ReturnType<typeof queryBudget>;
    lease: ScheduledWorkLease;
    signals: ScheduledSignal[];
    configuration: string;
    providers: ProviderSchedule;
    taskCheckins: boolean;
    discordWork?: boolean;
  },
  run: (admission: ScheduledAdmission) => Promise<void>,
) {
  const { lease, control } = state;
  const budget: ScheduledBudget = {
    controlUsage: () => control.usage,
    remaining: 31,
    deadline: Date.now() + 50_000,
    usage: emptyScheduledUsage(),
    controlReads: lease.guardReads + SCHEDULED_CONTROL_ALLOWANCE.reads,
    controlWrites: lease.guardWrites + SCHEDULED_CONTROL_ALLOWANCE.writes,
  };
  let failed = lease.metadataMissing > 0;
  let failure: Error | undefined;
  try {
    if (failed) throw new ScheduledWorkDeferred();
    await run({ ...state, db: control.db, budget });
  } catch (error) {
    failed = true;
    failure = error instanceof Error ? error : new ScheduledWorkDeferred();
    budget.usage.quota_exhausted ||= isD1QuotaExceeded(error);
    deferred(budget.usage.quota_exhausted ? 'account_quota' : 'unverified_or_spent_budget');
  } finally {
    accountControls(budget, control);
    try {
      await settleScheduledWork(env.PLATFORM_DB, lease, budget.usage, { failed, now: new Date() });
    } catch {
      deferred('settlement_unavailable');
      failure ??= new ScheduledWorkDeferred();
    }
  }
  if (failure) throw failure;
}
export async function withScheduledAdmission(
  controller: ScheduledController,
  env: ScheduledEnv,
  run: (admission: ScheduledAdmission) => Promise<void>,
) {
  const configuration = await configurationFor(env);
  const control = queryBudget(env.PLATFORM_DB, 30, { measureRows: true, strictRows: true });
  let signals: ScheduledSignal[];
  try {
    signals = await dueScheduledSignals(
      control.db,
      new Date(controller.scheduledTime),
      configuration.configuration,
    );
    if (!signals.length) return;
  } catch (error) {
    deferred(isD1QuotaExceeded(error) ? 'account_quota' : 'schedule_unavailable');
    return;
  }
  const lease = await reserve(env);
  if (lease) await executeAdmission(env, { ...configuration, control, lease, signals }, run);
}
