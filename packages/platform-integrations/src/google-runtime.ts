import type { ProviderConfiguration } from '@lasvegasfortransit/platform-core/access';

export interface GoogleAccessRuntimeEnv {
  LVBT_DEPLOYMENT_ENV?: string;
  LVBT_GOOGLE_ACCESS_OBSERVATIONS_ENABLED?: string;
  LVBT_GOOGLE_CUSTOMER_ID?: string;
  LVBT_GOOGLE_PRODUCTION_CUSTOMER_ID?: string;
}

function customerId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** Staff matches fresh, stored observations without receiving Google credentials. */
export function googleProviderConfiguration(env: GoogleAccessRuntimeEnv): ProviderConfiguration {
  const environment = env.LVBT_DEPLOYMENT_ENV;
  const id = env.LVBT_GOOGLE_CUSTOMER_ID;
  const productionId = env.LVBT_GOOGLE_PRODUCTION_CUSTOMER_ID;
  const isolated = environment === 'production' ? id === productionId : id !== productionId;
  return env.LVBT_GOOGLE_ACCESS_OBSERVATIONS_ENABLED === 'true' &&
    (environment === 'preview' || environment === 'production') &&
    customerId(id) &&
    customerId(productionId) &&
    isolated
    ? { configured: true, contextId: id }
    : { configured: false, contextId: '' };
}
