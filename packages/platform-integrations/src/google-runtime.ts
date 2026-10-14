import type { ProviderConfiguration } from '@lasvegasfortransit/platform-core/access';
import { parseGoogleGroupList, validGoogleGroupConfiguration } from './google-group-configuration';
import { workspaceEmail, type GoogleGroupsConfiguration } from './google-groups-types';

export interface GoogleAccessRuntimeEnv {
  LVBT_DEPLOYMENT_ENV?: string;
  LVBT_GOOGLE_ACCESS_OBSERVATIONS_ENABLED?: string;
  LVBT_GOOGLE_CUSTOMER_ID?: string;
  LVBT_GOOGLE_PRODUCTION_CUSTOMER_ID?: string;
  LVBT_GOOGLE_MANAGED_GROUPS?: string;
  LVBT_GOOGLE_PRODUCTION_GROUPS?: string;
  LVBT_GOOGLE_CONSOLE_GROUP_EMAIL?: string;
}
export interface GoogleGroupInventoryRuntime {
  provider: ProviderConfiguration;
  consoleGroupEmail: string | null;
}

/** One LVBT tenant; separate registered groups isolate preview writes. */
export function googleDirectoryConfiguration(
  env: GoogleAccessRuntimeEnv,
): GoogleGroupsConfiguration | null {
  const environment = env.LVBT_DEPLOYMENT_ENV;
  const customerId = env.LVBT_GOOGLE_CUSTOMER_ID;
  if (
    env.LVBT_GOOGLE_ACCESS_OBSERVATIONS_ENABLED !== 'true' ||
    (environment !== 'production' && environment !== 'preview') ||
    !customerId ||
    customerId !== env.LVBT_GOOGLE_PRODUCTION_CUSTOMER_ID
  )
    return null;
  const managedGroups = parseGoogleGroupList(env.LVBT_GOOGLE_MANAGED_GROUPS);
  const productionGroups = parseGoogleGroupList(env.LVBT_GOOGLE_PRODUCTION_GROUPS);
  if (!managedGroups || !productionGroups) return null;
  const consoleGroup = env.LVBT_GOOGLE_CONSOLE_GROUP_EMAIL;
  if (consoleGroup && !workspaceEmail(consoleGroup)) return null;
  const configuration: GoogleGroupsConfiguration = {
    environment,
    customerId,
    managedGroups,
    productionGroups,
    readOnlyGroups: consoleGroup ? [consoleGroup] : [],
  };
  return validGoogleGroupConfiguration(configuration) ? configuration : null;
}

/** Staff matches fresh stored observations without receiving Google credentials. */
export function googleProviderConfiguration(env: GoogleAccessRuntimeEnv): ProviderConfiguration {
  const configuration = googleDirectoryConfiguration(env);
  return configuration && configuration.managedGroups.length > 0
    ? {
        configured: true,
        contextId: configuration.customerId,
        resourceIds: [...configuration.managedGroups],
      }
    : { configured: false, contextId: '' };
}

export function googleGroupInventoryConfiguration(
  env: GoogleAccessRuntimeEnv,
): GoogleGroupInventoryRuntime {
  const configuration = googleDirectoryConfiguration(env);
  return {
    provider: configuration
      ? {
          configured: true,
          contextId: configuration.customerId,
          resourceIds: [...configuration.managedGroups, ...(configuration.readOnlyGroups ?? [])],
        }
      : { configured: false, contextId: '' },
    consoleGroupEmail: workspaceEmail(env.LVBT_GOOGLE_CONSOLE_GROUP_EMAIL)
      ? env.LVBT_GOOGLE_CONSOLE_GROUP_EMAIL
      : null,
  };
}
