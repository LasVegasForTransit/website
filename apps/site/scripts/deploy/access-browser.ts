import { test as base, type APIRequestContext } from '@playwright/test';
import { accessCredentials, accessHeaders, accessRequestOptions } from './access-auth';

export * from '@playwright/test';
export const test = base.extend<{ accessRequest: Pick<APIRequestContext, 'get'> }>({
  accessRequest: async ({ request, baseURL }, use) => {
    if (!baseURL) throw new Error('API browser checks require a baseURL.');
    const origin = new URL(baseURL).origin;
    const credentials = accessCredentials(process.env);
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
    const credentials = accessCredentials(process.env);
    if (credentials) {
      if (!baseURL) throw new Error('Access browser checks require a baseURL.');
      const origin = new URL(baseURL).origin;
      await context.route('**/*', async (route) => {
        const headers = accessHeaders(route.request().url(), origin, credentials);
        if (Object.keys(headers).length === 0) return route.continue();
        // route.continue headers survive redirects. Fetch with redirects disabled,
        // then let the browser follow the returned response as a new request.
        const response = await route.fetch({
          headers: { ...route.request().headers(), ...headers },
          maxRedirects: 0,
        });
        await route.fulfill({ response });
      });
    }
    await use(context);
  },
});
