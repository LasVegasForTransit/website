import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';

export interface TaskCheckinRuntimeEnv {
  LVBT_TASK_CHECKINS_ENABLED?: string;
  LVBT_TASK_UPDATES_ENABLED?: string;
  LVBT_DEPLOYMENT_ENV?: string;
  LVBT_NOTION_TASK_SOURCE_ID?: string;
  LVBT_NOTION_TASK_PRODUCTION_SOURCE_ID?: string;
  LVBT_DISCORD_APPLICATION_ID?: string;
  LVBT_DISCORD_GUILD_ID?: string;
  LVBT_DISCORD_PRODUCTION_GUILD_ID?: string;
}
function sourceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
}
function isolatedTaskContext(env: TaskCheckinRuntimeEnv) {
  const {
    LVBT_DEPLOYMENT_ENV: environment,
    LVBT_DISCORD_APPLICATION_ID: applicationId,
    LVBT_DISCORD_GUILD_ID: guildId,
    LVBT_DISCORD_PRODUCTION_GUILD_ID: productionGuildId,
    LVBT_NOTION_TASK_SOURCE_ID: configuredSource,
    LVBT_NOTION_TASK_PRODUCTION_SOURCE_ID: productionSource,
  } = env;
  if (
    !isDiscordId(applicationId) ||
    !isDiscordId(guildId) ||
    !isDiscordId(productionGuildId) ||
    !sourceId(configuredSource) ||
    !sourceId(productionSource)
  )
    return null;
  const production = environment === 'production';
  if (!production && environment !== 'preview') return null;
  if (
    production !== (guildId === productionGuildId) ||
    production !== (configuredSource.toLowerCase() === productionSource.toLowerCase())
  )
    return null;
  return {
    applicationId,
    guildId,
    sourceId: configuredSource.toLowerCase(),
    environment,
  };
}
export function taskCheckinContext(env: TaskCheckinRuntimeEnv) {
  return env.LVBT_TASK_CHECKINS_ENABLED === 'true' ? isolatedTaskContext(env) : null;
}
/** Manual updates and reminder delivery have independent switches; self-stop is always available. */
export function taskCheckinInteractionContext(env: TaskCheckinRuntimeEnv) {
  const context = isolatedTaskContext(env);
  return context
    ? {
        ...context,
        preferencesOnly:
          env.LVBT_TASK_CHECKINS_ENABLED !== 'true' && env.LVBT_TASK_UPDATES_ENABLED !== 'true',
      }
    : null;
}
export type TaskCheckinContext = NonNullable<ReturnType<typeof taskCheckinContext>>;
export type TaskCheckinInteractionContext = NonNullable<
  ReturnType<typeof taskCheckinInteractionContext>
>;

export interface TaskCheckinWorkerEnv extends TaskCheckinRuntimeEnv {
  LVBT_NOTION_TASK_API_KEY?: string;
  LVBT_DISCORD_BOT_TOKEN?: string;
}
export function taskCheckinWorkerRuntime(env: TaskCheckinWorkerEnv, allowUpdates = false) {
  const context =
    allowUpdates && env.LVBT_TASK_UPDATES_ENABLED === 'true'
      ? isolatedTaskContext(env)
      : taskCheckinContext(env);
  const notionToken = env.LVBT_NOTION_TASK_API_KEY?.trim(),
    botToken = env.LVBT_DISCORD_BOT_TOKEN?.trim();
  return context && notionToken && botToken ? { ...context, notionToken, botToken } : null;
}
