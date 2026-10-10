import type { ProviderConfiguration } from '@lasvegasfortransit/platform-core/access';
import { discordConfigured, discordId, type DiscordConfiguration } from './discord-types';
export interface DiscordRuntimeEnv {
  LVBT_DEPLOYMENT_ENV?: string;
  LVBT_DISCORD_SYNC_ENABLED?: string;
  LVBT_DISCORD_APPLICATION_ID?: string;
  LVBT_DISCORD_MEMBER_ROLE_ID?: string;
  LVBT_DISCORD_GUILD_ID?: string;
  LVBT_DISCORD_PRODUCTION_GUILD_ID?: string;
  LVBT_DISCORD_BOT_TOKEN?: string;
}
function context(env: DiscordRuntimeEnv) {
  const environment = env.LVBT_DEPLOYMENT_ENV;
  const guildId = env.LVBT_DISCORD_GUILD_ID;
  const productionGuildId = env.LVBT_DISCORD_PRODUCTION_GUILD_ID;
  const applicationId = env.LVBT_DISCORD_APPLICATION_ID;
  const memberRoleId = env.LVBT_DISCORD_MEMBER_ROLE_ID;
  if (
    env.LVBT_DISCORD_SYNC_ENABLED !== 'true' ||
    !['preview', 'production'].includes(environment ?? '') ||
    !discordId(guildId) ||
    !discordId(productionGuildId) ||
    !discordId(applicationId) ||
    !discordId(memberRoleId) ||
    memberRoleId === guildId ||
    (environment === 'production' ? guildId !== productionGuildId : guildId === productionGuildId)
  )
    return null;
  return {
    environment: environment as 'preview' | 'production',
    guildId,
    productionGuildId,
    applicationId,
    memberRoleId,
  };
}
export function discordRuntime(env: DiscordRuntimeEnv): {
  configuration: DiscordConfiguration;
  applicationId: string;
  memberRoleId: string;
} | null {
  const configured = context(env);
  if (!configured) return null;
  const configuration = {
    environment: configured.environment,
    guildId: configured.guildId,
    productionGuildId: configured.productionGuildId,
    botToken: env.LVBT_DISCORD_BOT_TOKEN ?? '',
  };
  return discordConfigured(configuration)
    ? {
        configuration,
        applicationId: configured.applicationId,
        memberRoleId: configured.memberRoleId,
      }
    : null;
}
/** Staff can match actual stored observations without receiving bot credentials. */
export function discordProviderConfiguration(env: DiscordRuntimeEnv): ProviderConfiguration {
  const configured = context(env);
  return configured
    ? { configured: true, contextId: configured.guildId, memberRoleId: configured.memberRoleId }
    : { configured: false, contextId: '' };
}
