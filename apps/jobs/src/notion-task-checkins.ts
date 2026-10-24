import { runMeteredJob, idleDatabaseJob } from './job-database';
import {
  queueTaskEscalations,
  processTaskEscalation,
} from '@lasvegasfortransit/platform-integrations/notion-task-escalations';
import {
  taskProviderCoolingDown,
  deferTaskProvider,
} from '@lasvegasfortransit/platform-storage/notion-task-provider-backoff';
import { processTaskCommentRecovery } from '@lasvegasfortransit/platform-integrations/notion-task-recovery';
import { processTaskCardRefresh } from '@lasvegasfortransit/platform-integrations/notion-task-refresh';
import { runDailyTaskDigestBatch } from '@lasvegasfortransit/platform-integrations/notion-task-digests';
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import { listTaskOperationQueue } from '@lasvegasfortransit/platform-storage/notion-task-reminders';
import {
  taskCheckinWorkerRuntime,
  taskCheckinContext,
  type TaskCheckinWorkerEnv,
} from '@lasvegasfortransit/platform-integrations/notion-task-runtime';
import { NotionTaskClient } from '@lasvegasfortransit/platform-integrations/notion-task-client';
import { DiscordTaskClient } from '@lasvegasfortransit/platform-integrations/notion-task-discord';
import { syncNotionTaskPage } from '@lasvegasfortransit/platform-integrations/notion-task-sync';
import {
  queueTaskReminders,
  processTaskDelivery,
} from '@lasvegasfortransit/platform-integrations/notion-task-delivery';
import { processNotionTaskAction } from '@lasvegasfortransit/platform-integrations/notion-task-actions';
import { runTaskCheckinCommandRegistration } from '@lasvegasfortransit/platform-integrations/notion-task-command';
import { discordRateLimit } from '@lasvegasfortransit/platform-integrations/discord-rate-limit';
interface TaskContext {
  runtime: NonNullable<ReturnType<typeof taskCheckinWorkerRuntime>>;
  budget: ReturnType<typeof queryBudget>;
}
async function runTaskJob<T extends object>(
  env: Env & TaskCheckinWorkerEnv,
  run: (context: TaskContext) => Promise<T>,
  options: { honorBackoff?: boolean; updates?: boolean } = {},
) {
  const runtime = taskCheckinWorkerRuntime(env, options.updates);
  if (!runtime) return idleDatabaseJob({ kind: 'idle' as const });
  return runMeteredJob(env.PLATFORM_DB, 'TaskCheckin', async (budget) => {
    if (
      options.honorBackoff !== false &&
      (await taskProviderCoolingDown(budget.db, runtime.sourceId, new Date()))
    )
      return { kind: 'idle' as const };
    return run({ runtime, budget });
  });
}
function notionClient(c: TaskContext, limited = false) {
  const clock = () => new Date();
  return new NotionTaskClient(
    c.runtime.notionToken,
    fetch,
    limited ? { maxRequests: 20, deadline: clock().getTime() + 40_000, clock } : undefined,
    (delay) => deferTaskProvider(c.budget.db, c.runtime.sourceId, delay, clock()),
  );
}
export class TaskCheckinCommands extends WorkerEntrypoint<Env & TaskCheckinWorkerEnv> {
  async run() {
    return runTaskJob(
      this.env,
      async (c) => {
        return runTaskCheckinCommandRegistration(c.budget.db, {
          applicationId: c.runtime.applicationId,
          guildId: c.runtime.guildId,
          botToken: c.runtime.botToken,
        });
      },
      { honorBackoff: false },
    );
  }
}
export class TaskCheckinScan extends WorkerEntrypoint<Env & TaskCheckinWorkerEnv> {
  async run() {
    return runTaskJob(
      this.env,
      async (c) => {
        return syncNotionTaskPage(c.budget.db, notionClient(c), c.runtime.sourceId);
      },
      { updates: true },
    );
  }
}
export class TaskCheckinQueue extends WorkerEntrypoint<Env & TaskCheckinWorkerEnv> {
  async run() {
    return runTaskJob(
      this.env,
      async (c) => {
        const result = await queueTaskReminders(c.budget.db, c.runtime.sourceId, () => new Date());
        return {
          kind: result.configurationRequired
            ? ('configuration_required' as const)
            : ('progress' as const),
          queued: result.queued,
          queries: c.budget.queries,
        };
      },
      { honorBackoff: false },
    );
  }
}
export class TaskCheckinOperation extends WorkerEntrypoint<Env & TaskCheckinWorkerEnv> {
  async run() {
    return runTaskJob(
      this.env,
      async (c) => {
        const db = c.budget.db,
          clock = () => new Date();
        const next = (
          await listTaskOperationQueue(db, c.runtime.sourceId, clock(), {
            limit: 1,
            includeDeliveries: Boolean(taskCheckinContext(this.env)),
          })
        )[0];
        if (!next) return { kind: 'idle' as const };
        const notion = notionClient(c);
        const discord = new DiscordTaskClient({
          guildId: c.runtime.guildId,
          botToken: c.runtime.botToken,
          rateLimit: discordRateLimit(db, c.runtime.applicationId, clock),
        });
        if (next.kind === 'delivery')
          await processTaskDelivery(db, { notion, discord }, next.id, clock);
        else
          await processNotionTaskAction(db, notion, next.id, {
            membership: (user, guild) => discord.membership(user, guild),
            clock,
          });
        return { kind: 'progress' as const, queries: c.budget.queries };
      },
      { updates: true },
    );
  }
}

export class TaskCheckinDigest extends WorkerEntrypoint<Env & TaskCheckinWorkerEnv> {
  async run() {
    return runTaskJob(this.env, async (c) => {
      const db = c.budget.db,
        clock = () => new Date();
      const notion = notionClient(c);
      const discord = new DiscordTaskClient({
        guildId: c.runtime.guildId,
        botToken: c.runtime.botToken,
        rateLimit: discordRateLimit(db, c.runtime.applicationId, clock),
      });
      const result = await runDailyTaskDigestBatch(
        db,
        { notion, discord },
        c.runtime.sourceId,
        clock,
      );
      return { ...result, kind: 'progress' as const, queries: c.budget.queries };
    });
  }
}

export class TaskCheckinRefresh extends WorkerEntrypoint<Env & TaskCheckinWorkerEnv> {
  async run() {
    return runTaskJob(
      this.env,
      async (c) => {
        const db = c.budget.db,
          clock = () => new Date();
        const notion = notionClient(c);
        const discord = new DiscordTaskClient({
          guildId: c.runtime.guildId,
          botToken: c.runtime.botToken,
          rateLimit: discordRateLimit(db, c.runtime.applicationId, clock),
        });
        const result = await processTaskCardRefresh(
          db,
          { notion, discord },
          c.runtime.sourceId,
          clock,
        );
        return { ...result, queries: c.budget.queries };
      },
      { updates: true },
    );
  }
}

export class TaskCheckinRecovery extends WorkerEntrypoint<Env & TaskCheckinWorkerEnv> {
  async run() {
    return runTaskJob(
      this.env,
      async (c) => {
        const result = await processTaskCommentRecovery(
          c.budget.db,
          notionClient(c),
          c.runtime.sourceId,
          () => new Date(),
        );
        return { ...result, queries: c.budget.queries };
      },
      { updates: true },
    );
  }
}

export class TaskCheckinEscalation extends WorkerEntrypoint<Env & TaskCheckinWorkerEnv> {
  async run() {
    return runTaskJob(this.env, async (c) => {
      const db = c.budget.db,
        clock = () => new Date();
      const notion = notionClient(c, true);
      const discord = new DiscordTaskClient({
        guildId: c.runtime.guildId,
        botToken: c.runtime.botToken,
        rateLimit: discordRateLimit(db, c.runtime.applicationId, clock),
      });
      const result = await processTaskEscalation(
        db,
        { notion, discord },
        c.runtime.sourceId,
        clock,
      );
      const evaluated = await queueTaskEscalations(db, notion, c.runtime.sourceId, clock);
      return { ...result, evaluated, queries: c.budget.queries };
    });
  }
}
