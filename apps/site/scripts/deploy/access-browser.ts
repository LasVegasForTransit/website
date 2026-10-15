import { test as base, type APIRequestContext } from '@playwright/test';
import { scopeBrowserAccess } from '@lasvegasfortransit/web-platform/release';
import { accessRequestOptions, type AccessCredentials } from './access-auth';
import { releaseBrowserCredentials } from './release-access';
import { releaseConfiguration } from './release-config';

export function scopedAccessRequest(
  request: Pick<APIRequestContext, 'get' | 'fetch'>,
  baseURL: string,
  credentials?: AccessCredentials,
): Pick<APIRequestContext, 'get' | 'fetch'> {
  const origin = new URL(baseURL).origin;
  const optionsFor = (url: string, options?: Parameters<APIRequestContext['fetch']>[1]) => {
    const authentication = accessRequestOptions(url, origin, credentials);
    return {
      ...options,
      ...authentication,
      headers: { ...options?.headers, ...authentication.headers },
    };
  };
  return {
    get: (url, options) => {
      const absolute = new URL(url, baseURL).href;
      return request.get(absolute, optionsFor(absolute, options));
    },
    fetch: (url, options) => {
      const absolute = new URL(typeof url === 'string' ? url : url.url(), baseURL).href;
      return request.fetch(absolute, optionsFor(absolute, options));
    },
  };
}

export * from '@playwright/test';
export const test = base.extend<{ accessRequest: Pick<APIRequestContext, 'get' | 'fetch'> }>({
  accessRequest: async ({ request, baseURL }, use) => {
    if (!baseURL) throw new Error('API browser checks require a baseURL.');
    const origin = new URL(baseURL).origin;
    const credentials = releaseBrowserCredentials(origin, releaseConfiguration);
    await use(scopedAccessRequest(request, baseURL, credentials));
  },
  context: async ({ context, baseURL }, use) => {
    if (!baseURL) throw new Error('Access browser checks require a baseURL.');
    const origin = new URL(baseURL).origin;
    const credentials = releaseBrowserCredentials(origin, releaseConfiguration);
    if (credentials) {
      await scopeBrowserAccess(context, origin, credentials);
    }
    try {
      await use(context);
    } finally {
      // Finish Access fetch/fulfill handlers before Playwright disposes their responses.
      await context.unrouteAll({ behavior: 'wait' });
    }
  },
});
