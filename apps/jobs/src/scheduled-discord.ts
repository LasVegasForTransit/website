import { WorkerEntrypoint } from 'cloudflare:workers';
import { runDiscordCommandRegistration } from '@lasvegasfortransit/platform-integrations/discord-command-registration';
import {
  discordRuntime,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';
import { reconcileDiscordPending } from '@lasvegasfortransit/platform-integrations/discord-runner';
import { DiscordAccess } from '@lasvegasfortransit/platform-integrations/discord-access';
import { discordRateLimit } from '@lasvegasfortransit/platform-integrations/discord-rate-limit';
import { scanDiscordGuildRoster } from '@lasvegasfortransit/platform-integrations/discord-roster';
import { queueDiscordDrift } from '@lasvegasfortransit/platform-storage/discord-drift';
import {
  queryBudget,
  QueryBudgetExceeded,
} from '@lasvegasfortransit/platform-storage/query-budget';

export class DiscordAccount extends WorkerEntrypoint<Env & DiscordRuntimeEnv> {
  async run() {
    const runtime = discordRuntime(this.env);
    if (!runtime) return { selected: 0, failed: false, paused: false, queries: 0 };
    const budget = queryBudget(this.env.PLATFORM_DB, 50);
    try {
      const result = await reconcileDiscordPending(budget.db, {
        ...runtime,
        limit: 1,
        changeLimit: 1,
      });
      return { ...result, failed: false, queries: budget.queries };
    } catch (error) {
      return {
        selected: 0,
        failed: true,
        paused: false,
        queries: budget.queries,
        failure: error instanceof QueryBudgetExceeded ? 'query_budget' : 'storage_error',
      };
    }
  }
}
export class DiscordScan extends WorkerEntrypoint<Env & DiscordRuntimeEnv> {
  async run() {
    const runtime = discordRuntime(this.env);
    if (!runtime) return { ready: false, queries: 0 };
    const budget = queryBudget(this.env.PLATFORM_DB, 50);
    const drift = await queueDiscordDrift(budget.db, { guildId: runtime.configuration.guildId });
    const client = new DiscordAccess(runtime.configuration, {
      rateLimit: discordRateLimit(budget.db, runtime.applicationId),
    });
    const roster = await scanDiscordGuildRoster(budget.db, {
      client,
      memberRoleId: runtime.memberRoleId,
    });
    return { ready: true, drift, roster, queries: budget.queries };
  }
}

export class DiscordCommands extends WorkerEntrypoint<Env & DiscordRuntimeEnv> {
  async run() {
    const runtime = discordRuntime(this.env);
    if (!runtime) return { kind: 'idle' as const, queries: 0 };
    const budget = queryBudget(this.env.PLATFORM_DB, 50);
    const result = await runDiscordCommandRegistration(budget.db, {
      applicationId: runtime.applicationId,
      guildId: runtime.configuration.guildId,
      botToken: runtime.configuration.botToken,
    });
    return { ...result, queries: budget.queries };
  }
}
