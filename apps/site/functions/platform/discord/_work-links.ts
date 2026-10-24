import { notionObject } from '@lasvegasfortransit/platform-integrations/notion-task-types';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { readTaskCheckinSource } from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import {
  handleWorkInteraction,
  type WorkPreviewBinding,
} from '@lasvegasfortransit/platform-integrations/discord-work-interactions';
import {
  workInspectionRuntime,
  type WorkRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-work-runtime';
export interface WorkInteractionEnv extends WorkRuntimeEnv {
  PLATFORM_DB?: Db;
  DISCORD_WORK?: WorkPreviewBinding;
}
export async function discordWorkInteraction(
  env: WorkInteractionEnv,
  interaction: unknown,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response | null> {
  const data = notionObject(notionObject(interaction).data);
  if (
    data.name !== 'work' &&
    data.name !== 'Save to Notion' &&
    !(typeof data.custom_id === 'string' && data.custom_id.startsWith('work:'))
  )
    return null;
  const runtime = workInspectionRuntime(env);
  const db = env.PLATFORM_DB;
  if (!runtime || !db) return null;
  return handleWorkInteraction(db, interaction, {
    ...runtime,
    loadScope: async () => {
      const source = await readTaskCheckinSource(db, runtime.sourceId);
      return source
        ? {
            environment: runtime.environment,
            guildId: runtime.guildId,
            workspaceId: source.workspace_id,
          }
        : undefined;
    },
    preview: env.DISCORD_WORK ?? {
      preview: () => Promise.resolve({ kind: 'unavailable', reason: 'configuration_required' }),
    },
    waitUntil,
  });
}
