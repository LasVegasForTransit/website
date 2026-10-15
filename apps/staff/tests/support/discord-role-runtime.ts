import { fileURLToPath } from 'node:url';
import type { V4SharedOptions, V4WorkerOptions, Response as RuntimeResponse } from 'miniflare';
export interface DiscordRoleRuntimeOptions {
  enabled: boolean;
  fetch: (request: Request) => RuntimeResponse | Promise<RuntimeResponse>;
}
export function discordRoleRuntime(
  options: V4SharedOptions & V4WorkerOptions,
  discord: DiscordRoleRuntimeOptions,
) {
  const {
    host,
    port,
    https,
    httpsKey,
    httpsCert,
    resourcePersistencePath,
    cf,
    telemetry,
    ...staff
  } = options;
  return {
    host,
    port,
    https,
    httpsKey,
    httpsCert,
    resourcePersistencePath,
    cf,
    telemetry,
    workers: [
      { ...staff, serviceBindings: { LVBT_NEWSLETTER_JOBS: 'lvbt-jobs-discord-fixture' } },
      {
        name: 'lvbt-jobs-discord-fixture',
        modules: true,
        scriptPath: fileURLToPath(new URL('../../../jobs/dist/index.js', import.meta.url)),
        modulesRoot: fileURLToPath(new URL('../../../jobs/dist/', import.meta.url)),
        compatibilityDate: '2026-09-04',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { PLATFORM_DB: 'browser-fixture-db' },
        bindings: {
          LVBT_DEPLOYMENT_ENV: 'preview',
          LVBT_DISCORD_SYNC_ENABLED: String(discord.enabled),
          LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
          LVBT_DISCORD_GUILD_ID: '111111111111111111',
          LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
          LVBT_DISCORD_MEMBER_ROLE_ID: '333333333333333333',
          LVBT_DISCORD_BOT_TOKEN: 'fixture-token-jobs-only',
        },
        outboundService: discord.fetch,
      },
    ],
  };
}
