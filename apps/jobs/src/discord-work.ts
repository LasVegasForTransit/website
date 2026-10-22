import { WorkerEntrypoint } from 'cloudflare:workers';
import { readTaskCheckinSource } from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { NotionTaskClient } from '@lasvegasfortransit/platform-integrations/notion-task-client';
import { DiscordWorkClient } from '@lasvegasfortransit/platform-integrations/discord-work-provider';
import {
  workInspectionRuntime,
  workLinkRuntime,
  type WorkRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-work-runtime';
import { runWorkPreview } from '@lasvegasfortransit/platform-integrations/discord-work-setup';
import { runDiscordWorkBatch } from '@lasvegasfortransit/platform-integrations/discord-work-runner';
import {
  WORK_COMMAND,
  SAVE_TO_NOTION_COMMAND,
} from '@lasvegasfortransit/platform-integrations/discord-work-command';
import { runDiscordCommandRegistration } from '@lasvegasfortransit/platform-integrations/discord-command-registration';
import { discordRateLimit } from '@lasvegasfortransit/platform-integrations/discord-rate-limit';
import type {
  WorkPreviewInput,
  WorkPreviewResult,
} from '@lasvegasfortransit/platform-integrations/discord-work-interactions';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { runMeteredJob, idleDatabaseJob } from './job-database';
type WorkEnv = Env & WorkRuntimeEnv;
function providers(
  env: WorkEnv,
  db: Db,
  context: NonNullable<ReturnType<typeof workInspectionRuntime>>,
) {
  const clock = () => new Date(),
    deadline = Date.now() + 40_000;
  return {
    notion: new NotionTaskClient(env.LVBT_NOTION_TASK_API_KEY ?? '', fetch, {
      maxRequests: 20,
      deadline,
      clock,
    }),
    discord: new DiscordWorkClient({
      guildId: context.guildId,
      applicationId: context.applicationId,
      botToken: env.LVBT_DISCORD_BOT_TOKEN ?? '',
      allowWrites: context.enabled,
      timeoutMs: 2500,
      rateLimit: discordRateLimit(db, context.applicationId, clock),
    }),
  };
}
export class WorkPreview extends WorkerEntrypoint<WorkEnv> {
  async preview(input: WorkPreviewInput): Promise<WorkPreviewResult> {
    const runtime = workInspectionRuntime(this.env);
    if (input.applicationId !== runtime?.applicationId || input.guildId !== runtime.guildId)
      return { kind: 'unavailable', reason: 'configuration_required' };
    return runMeteredJob(this.env.PLATFORM_DB, 'DiscordWorkPreview', async (budget) => {
      const source = await readTaskCheckinSource(budget.db, runtime.sourceId);
      if (!source) return { kind: 'unavailable' as const, reason: 'source_required' };
      return runWorkPreview(budget.db, providers(this.env, budget.db, runtime), input, {
        scope: {
          environment: runtime.environment,
          guildId: runtime.guildId,
          workspaceId: source.workspace_id,
        },
        taskSourceId: runtime.sourceId,
        enabled: runtime.enabled,
        clock: () => new Date(),
      });
    });
  }
}
async function runWorkJob(env: WorkEnv, stage: 'ingest' | 'effects' | 'refresh') {
  const runtime = workLinkRuntime(env);
  if (!runtime) return idleDatabaseJob({ kind: 'idle' as const });
  return runMeteredJob(env.PLATFORM_DB, `DiscordWork:${stage}`, async (budget) => {
    const source = await readTaskCheckinSource(budget.db, runtime.sourceId);
    if (!source) return { kind: 'idle' as const };
    return runDiscordWorkBatch(budget.db, providers(env, budget.db, runtime), {
      scope: {
        environment: runtime.environment,
        guildId: runtime.guildId,
        workspaceId: source.workspace_id,
      },
      taskSourceId: runtime.sourceId,
      enabled: true,
      clock: () => new Date(),
      stage,
      deadline: Date.now() + 40_000,
      maxLinks: 1,
      maxEffects: 1,
    });
  });
}
export class DiscordWorkIngest extends WorkerEntrypoint<WorkEnv> {
  async run() {
    return runWorkJob(this.env, 'ingest');
  }
}
export class DiscordWorkEffects extends WorkerEntrypoint<WorkEnv> {
  async run() {
    return runWorkJob(this.env, 'effects');
  }
}
export class DiscordWorkRefresh extends WorkerEntrypoint<WorkEnv> {
  async run() {
    return runWorkJob(this.env, 'refresh');
  }
}
export class DiscordWorkCommands extends WorkerEntrypoint<WorkEnv> {
  async run() {
    const runtime = workLinkRuntime(this.env);
    if (!runtime) return idleDatabaseJob({ kind: 'idle' as const });
    return runMeteredJob(this.env.PLATFORM_DB, 'DiscordWorkCommands', async (budget) => {
      for (const command of [WORK_COMMAND, SAVE_TO_NOTION_COMMAND]) {
        const result = await runDiscordCommandRegistration(budget.db, {
          applicationId: runtime.applicationId,
          guildId: runtime.guildId,
          botToken: runtime.botToken,
          command,
        });
        if (result.kind === 'failed' || result.kind === 'paused') return result;
      }
      return { kind: 'complete' as const };
    });
  }
}
