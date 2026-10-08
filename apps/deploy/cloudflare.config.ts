import { bindings, defineConfig } from 'cf/config';

const commonWorker = {
  compatibilityDate: '2026-09-04',
  compatibilityFlags: ['nodejs_compat'],
  entrypoint: '../site/.wrangler/worker/index.js',
  workersDev: false,
  previewUrls: true,
  observability: { enabled: true },
  // Recovery must retain every stored credential, including preview test secrets
  // and optional credentials not declared below. cf forwards this upload metadata.
  unsafe: { metadata: { keep_bindings: ['secret_text', 'secret_key'] } },
  assets: {
    notFoundHandling: '404-page' as const,
    runWorkerFirst: [
      '/api/*',
      '/press',
      '/press/*',
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
        worker: {
          ...commonWorker,
          name: 'lvbt-website-preview',
          domains: ['preview.lasvegasfortransit.org'],
          assets: { ...commonWorker.assets, runWorkerFirst: true },
          env: {
            PLATFORM_DB: bindings.d1({
              name: 'lvbt-platform-preview',
              id: '8bb072e7-9865-487a-8867-d97fdb2ea00b',
            }),
            ASSETS: bindings.assets(),
            LVBT_DEPLOYMENT_ENV: bindings.text('preview'),
            LVBT_RESEND_API_KEY: bindings.secret(),
            LVBT_BEEHIIV_API_KEY: bindings.secret(),
            LVBT_BEEHIIV_PUBLICATION_ID: bindings.secret(),
            LVBT_MEMBERSHIP_INTAKE_SECRET: bindings.secret(),
            LVBT_NOTION_API_KEY: bindings.secret(),
            LVBT_NOTION_DATA_SOURCE_ID: bindings.secret(),
            LVBT_PRESS_DATA_SOURCE_ID: bindings.secret(),
            LVBT_TRANSIT_NEWS_INTAKE_SECRET: bindings.secret(),
            LVBT_SIGN_IN_SECRET: bindings.secret(),
            LVBT_LINK_SIGNING_SECRET: bindings.secret(),
          },
        },
      };
    }
    default: {
      return {
        worker: {
          ...commonWorker,
          name: 'lvbt-website',
          domains: ['lasvegasfortransit.org', 'www.lasvegasfortransit.org'],
          env: {
            PLATFORM_DB: bindings.d1({
              name: 'lvbt-platform',
              id: 'dcde8dbd-d827-4405-85b4-97bc2accc906',
            }),
            ASSETS: bindings.assets(),
            LVBT_DEPLOYMENT_ENV: bindings.text('production'),
            LVBT_RESEND_API_KEY: bindings.secret(),
            LVBT_BEEHIIV_API_KEY: bindings.secret(),
            LVBT_BEEHIIV_PUBLICATION_ID: bindings.secret(),
            LVBT_MEMBERSHIP_INTAKE_SECRET: bindings.secret(),
            LVBT_NOTION_API_KEY: bindings.secret(),
            LVBT_NOTION_DATA_SOURCE_ID: bindings.secret(),
            LVBT_PRESS_DATA_SOURCE_ID: bindings.secret(),
            LVBT_TRANSIT_NEWS_INTAKE_SECRET: bindings.secret(),
            LVBT_SIGN_IN_SECRET: bindings.secret(),
            LVBT_LINK_SIGNING_SECRET: bindings.secret(),
          },
        },
      };
    }
  }
});
