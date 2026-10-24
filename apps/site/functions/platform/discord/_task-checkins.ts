import { notionObject } from '@lasvegasfortransit/platform-integrations/notion-task-types';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  taskCheckinInteractionContext,
  type TaskCheckinRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/notion-task-runtime';
import { handleTaskInteraction } from '@lasvegasfortransit/platform-integrations/notion-task-interactions';

export interface TaskInteractionEnv extends TaskCheckinRuntimeEnv {
  PLATFORM_DB?: Db;
  LVBT_DISCORD_JOBS?: Pick<Fetcher, 'fetch'>;
}
export async function taskCheckinInteraction(
  env: TaskInteractionEnv,
  interaction: unknown,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response | null> {
  const context = taskCheckinInteractionContext(env);
  if (!context || !env.PLATFORM_DB) return null;
  const response = await handleTaskInteraction(env.PLATFORM_DB, interaction, context);
  const event = notionObject(interaction);
  const custom = notionObject(event.data).custom_id;
  if (
    response?.ok &&
    waitUntil &&
    env.LVBT_DISCORD_JOBS &&
    (event.type === 5 || (event.type === 3 && notionObject(event.data).component_type === 3)) &&
    typeof event.id === 'string' &&
    typeof custom === 'string' &&
    custom.startsWith('tc:')
  ) {
    waitUntil(
      env.LVBT_DISCORD_JOBS.fetch('https://jobs.internal/notion/task-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: event.id }),
      })
        .then(async (result) => {
          await result.body?.cancel();
        })
        .catch(() => undefined),
    );
  }
  return response;
}
