import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  taskCheckinInteractionContext,
  type TaskCheckinRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/notion-task-runtime';
import { handleTaskInteraction } from '@lasvegasfortransit/platform-integrations/notion-task-interactions';

export interface TaskInteractionEnv extends TaskCheckinRuntimeEnv {
  PLATFORM_DB?: Db;
}
export function taskCheckinInteraction(
  env: TaskInteractionEnv,
  interaction: unknown,
): Promise<Response | null> {
  const context = taskCheckinInteractionContext(env);
  if (!context || !env.PLATFORM_DB) return Promise.resolve(null);
  return handleTaskInteraction(env.PLATFORM_DB, interaction, context);
}
