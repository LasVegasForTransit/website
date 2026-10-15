import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Response as RuntimeResponse, type V4SharedOptions, type V4WorkerOptions } from 'miniflare';
export function newsletterRuntime(options: V4SharedOptions & V4WorkerOptions, enabled = false) {
  if (!enabled) return options;
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
      { ...staff, serviceBindings: { LVBT_NEWSLETTER_JOBS: 'lvbt-jobs-newsletter-fixture' } },
      {
        name: 'lvbt-jobs-newsletter-fixture',
        modules: true,
        scriptPath: fileURLToPath(new URL('../../../jobs/dist/index.js', import.meta.url)),
        modulesRoot: fileURLToPath(new URL('../../../jobs/dist/', import.meta.url)),
        compatibilityDate: '2026-09-04',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { PLATFORM_DB: 'browser-fixture-db' },
        bindings: {
          LVBT_DEPLOYMENT_ENV: 'preview',
          LVBT_BEEHIIV_SYNC_ENABLED: 'false',
          LVBT_BEEHIIV_PUBLICATION_ID: 'pub_review',
          LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID: 'pub_production',
          LVBT_BEEHIIV_API_KEY: 'fixture-api-key',
          LVBT_NEWSLETTER_INTENT_KEY: 'a'.repeat(43),
        },
        outboundService: (request: Request) => {
          assert.equal(request.method, 'GET');
          assert.equal(
            request.url,
            'https://api.beehiiv.com/v2/publications/pub_review/subscriptions/sub_unknown',
          );
          return new RuntimeResponse(
            JSON.stringify({
              data: {
                id: 'sub_unknown',
                email: 'unknown-rider@example.invalid',
                status: 'active',
                created: Math.floor(Date.now() / 1000) - 3600,
              },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    ],
  };
}
