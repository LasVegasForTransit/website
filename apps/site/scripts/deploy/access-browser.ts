import { test as base, type APIRequestContext } from '@playwright/test';
import { scopeBrowserAccess } from '@lasvegasfortransit/web-platform/release';
import { accessRequestOptions } from './access-auth';
import { releaseBrowserCredentials } from './release-access';
import { releaseConfiguration } from './release-config';

export * from '@playwright/test';
export const test = base.extend<{ accessRequest: Pick<APIRequestContext, 'get'> }>({
  accessRequest: async ({ request, baseURL }, use) => {
    if (!baseURL) throw new Error('API browser checks require a baseURL.');
    const origin = new URL(baseURL).origin;
    const credentials = releaseBrowserCredentials(origin, releaseConfiguration);
    await use({
      get: (url, options) => {
        const absolute = new URL(url, baseURL).href;
        const authentication = accessRequestOptions(absolute, origin, credentials);
        return request.get(absolute, {
          ...options,
          ...authentication,
          headers: { ...options?.headers, ...authentication.headers },
        });
      },
    });
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
