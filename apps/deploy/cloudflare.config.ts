import { bindings, defineConfig } from 'cf/config';

const accountId = '2557b5c2e166292ded0f8425b73075e9';
const commonWorker = {
  compatibilityDate: '2026-09-04',
  compatibilityFlags: ['nodejs_compat'],
  entrypoint: '../site/.wrangler/worker/index.js',
  workersDev: false,
  previewUrls: true,
  observability: { enabled: true },
  assets: {
    notFoundHandling: '404-page' as const,
    runWorkerFirst: [
      '/api/*',
      '/join/member',
      '/join/member/*',
      '/join/remove',
      '/join/remove/*',
      '/sign-in',
      '/sign-in/*',
      '/sign-out',
      '/sign-out/*',
      '/account',
      '/account/*',
      '/prototypes/join',
      '/prototypes/join/*',
    ],
  },
};

export default defineConfig((ctx) => {
  switch (ctx.mode) {
    case 'preview': {
      return {
        accountId,
        worker: {
          ...commonWorker,
          name: 'lvbt-website-preview',
          env: {
            PLATFORM_DB: bindings.d1({
              name: 'lvbt-platform-preview',
              id: '8bb072e7-9865-487a-8867-d97fdb2ea00b',
            }),
            ASSETS: bindings.assets(),
          },
        },
      };
    }
    default: {
      return {
        accountId,
        worker: {
          ...commonWorker,
          name: 'lvbt-website',
          env: {
            PLATFORM_DB: bindings.d1({
              name: 'lvbt-platform',
              id: 'dcde8dbd-d827-4405-85b4-97bc2accc906',
            }),
            ASSETS: bindings.assets(),
            LVBT_RESEND_API_KEY: bindings.secret(),
            LVBT_BEEHIIV_API_KEY: bindings.secret(),
            LVBT_BEEHIIV_PUBLICATION_ID: bindings.secret(),
            LVBT_MEMBERSHIP_INTAKE_SECRET: bindings.secret(),
            LVBT_NOTION_API_KEY: bindings.secret(),
            LVBT_NOTION_DATA_SOURCE_ID: bindings.secret(),
            LVBT_TRANSIT_NEWS_INTAKE_SECRET: bindings.secret(),
            LVBT_SIGN_IN_SECRET: bindings.secret(),
            LVBT_LINK_SIGNING_SECRET: bindings.secret(),
          },
        },
      };
    }
  }
});
