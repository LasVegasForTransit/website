import type { BeehiivSyncOptions } from './beehiiv-sync';

export interface BeehiivRuntimeEnv {
  LVBT_DEPLOYMENT_ENV?: string;
  LVBT_BEEHIIV_SYNC_ENABLED?: string;
  LVBT_BEEHIIV_PUBLICATION_ID?: string;
  LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID?: string;
  LVBT_BEEHIIV_API_KEY?: string;
  LVBT_NEWSLETTER_INTENT_KEY?: string;
  LVBT_BEEHIIV_WEBHOOK_SECRET?: string;
}
function publication(value: string | undefined): value is string {
  return Boolean(value && /^pub_[A-Za-z0-9_-]{1,124}$/.test(value));
}
export function beehiivRuntime(env: BeehiivRuntimeEnv): BeehiivSyncOptions | null {
  const environment = env.LVBT_DEPLOYMENT_ENV;
  const publicationId = env.LVBT_BEEHIIV_PUBLICATION_ID;
  const productionId = env.LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID;
  const apiKey = env.LVBT_BEEHIIV_API_KEY?.trim();
  const intentKey = env.LVBT_NEWSLETTER_INTENT_KEY;
  if (
    env.LVBT_BEEHIIV_SYNC_ENABLED !== 'true' ||
    !publication(publicationId) ||
    !publication(productionId)
  )
    return null;
  if (environment !== 'preview' && environment !== 'production') return null;
  if (environment === 'preview' ? publicationId === productionId : publicationId !== productionId)
    return null;
  if (!apiKey || !intentKey || !/^[A-Za-z0-9_-]{43}$/.test(intentKey) || apiKey === intentKey)
    return null;
  return { configuration: { publicationId, apiKey }, intentKey, targetLimit: 1 };
}
