import { taskCheckinInteractionContext, type TaskCheckinWorkerEnv } from './notion-task-runtime';
export interface WorkRuntimeEnv extends TaskCheckinWorkerEnv {
  LVBT_DISCORD_WORK_ENABLED?: string;
}
export function workInspectionRuntime(env: WorkRuntimeEnv) {
  const context = taskCheckinInteractionContext(env);
  if (!context) return null;
  const environment: 'production' | 'preview' =
    context.environment === 'production' ? 'production' : 'preview';
  return { ...context, environment, enabled: env.LVBT_DISCORD_WORK_ENABLED === 'true' };
}
export function workLinkRuntime(env: WorkRuntimeEnv) {
  const context = workInspectionRuntime(env);
  return context?.enabled &&
    env.LVBT_NOTION_TASK_API_KEY?.trim() &&
    env.LVBT_DISCORD_BOT_TOKEN?.trim()
    ? {
        ...context,
        notionToken: env.LVBT_NOTION_TASK_API_KEY.trim(),
        botToken: env.LVBT_DISCORD_BOT_TOKEN.trim(),
      }
    : null;
}
