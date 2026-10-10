import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
interface Mode {
  unsafe?: boolean;
  paginatedBypass?: boolean;
  denied?: boolean;
  disabled?: boolean;
  mismatch?: boolean;
  productionDiscord?: boolean;
  mixedVersions?: boolean;
  exposedSubdomain?: boolean;
  exposedDomain?: boolean;
  exposedRoute?: boolean;
}
const databaseId = '8bb072e7-9865-487a-8867-d97fdb2ea00b';
const policy = {
  decision: 'allow',
  session_duration: '12h',
  include: [
    { gsuite: { email: 'console-users@lasvegasfortransit.org', identity_provider_id: 'google' } },
  ],
  require: [{ email_domain: { domain: 'lasvegasfortransit.org' } }],
};
function bindings(path: string, mode: Mode) {
  const secrets = path.includes('jobs')
    ? ['LVBT_DISCORD_BOT_TOKEN']
    : [
        'LVBT_SIGN_IN_SECRET',
        'LVBT_GOOGLE_OAUTH_CLIENT_ID',
        'LVBT_GOOGLE_OAUTH_CLIENT_SECRET',
        'LVBT_RESEND_API_KEY',
      ];
  const guildId = mode.productionDiscord
    ? '444444444444444444'
    : mode.mismatch && path.includes('jobs')
      ? '333333333333333333'
      : '222222222222222222';
  const vars = {
    LVBT_ACCESS_AUD: 'staff-audience',
    LVBT_ACCESS_TEAM_DOMAIN: 'lvbt.cloudflareaccess.com',
    LVBT_DEPLOYMENT_ENV: mode.productionDiscord ? 'production' : 'preview',
    LVBT_DISCORD_SYNC_ENABLED: mode.disabled ? 'false' : 'true',
    LVBT_DISCORD_APPLICATION_ID: '111111111111111111',
    LVBT_DISCORD_GUILD_ID: guildId,
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '444444444444444444',
    LVBT_DISCORD_MEMBER_ROLE_ID: '555555555555555555',
    LVBT_GOOGLE_ACCESS_OBSERVATIONS_ENABLED: 'false',
    LVBT_GOOGLE_CUSTOMER_ID: '',
    LVBT_GOOGLE_PRODUCTION_CUSTOMER_ID: '',
  };
  return [
    {
      type: 'd1',
      name: 'PLATFORM_DB',
      id: mode.unsafe && path.includes('jobs') ? 'production-db' : databaseId,
    },
    ...secrets.map((name) => ({ type: 'secret_text', name, text: 'DO-NOT-PRINT-SECRET' })),
    ...Object.entries(vars).map(([name, text]) => ({ type: 'plain_text', name, text })),
  ];
}
function deployment(mode: Mode) {
  return {
    deployments: [
      {
        id: 'deployment',
        versions: mode.mixedVersions
          ? [
              { version_id: 'version', percentage: 50 },
              { version_id: 'old-version', percentage: 50 },
            ]
          : [{ version_id: 'version', percentage: 100 }],
      },
    ],
  };
}
function version(path: string, mode: Mode) {
  const unsafe =
    mode.unsafe === true || (mode.mixedVersions === true && path.endsWith('/old-version'));
  return {
    id: path.split('/').at(-1),
    resources: { bindings: bindings(path, { ...mode, unsafe }) },
  };
}
function migrationRows(root: string, mode: Mode) {
  const names = readdirSync(resolve(root, 'packages/platform-storage/migrations')).filter((name) =>
    name.endsWith('.sql'),
  );
  return [
    {
      success: true,
      results: names
        .filter((name) => !mode.unsafe || !name.startsWith('0025'))
        .map((name) => ({ name })),
    },
  ];
}
function metadata(url: URL, mode: Mode, root: string): unknown {
  const path = url.pathname;
  if (path.includes('/versions/')) return version(path, mode);
  const handlers: Record<string, () => unknown> = {
    settings: () => ({ bindings: bindings(path, mode) }),
    deployments: () => deployment(mode),
    subdomain: () => ({ enabled: Boolean(mode.exposedSubdomain), previews_enabled: false }),
    domains: () => [
      { hostname: 'staff-preview.lasvegasfortransit.org', service: 'lvbt-staff-preview' },
      ...(mode.exposedDomain
        ? [{ hostname: 'jobs.example.org', service: 'lvbt-jobs-preview' }]
        : []),
    ],
    zones: () => (mode.exposedRoute ? [{ id: 'test-zone', account: { id: 'test-account' } }] : []),
    routes: () => [
      { id: 'test-route', pattern: 'jobs.example.org/*', script: 'lvbt-jobs-preview' },
    ],
    schedules: () => ({ schedules: [{ cron: '* * * * *' }] }),
    apps: () => [
      {
        id: 'staff-app',
        domain: 'staff-preview.lasvegasfortransit.org',
        aud: 'staff-audience',
        session_duration: '12h',
        type: 'self_hosted',
      },
    ],
    policies: () =>
      url.searchParams.get('page') === '2'
        ? [{ decision: 'bypass' }]
        : [policy, ...(mode.unsafe ? [{ decision: 'allow', include: [{ everyone: {} }] }] : [])],
    query: () => migrationRows(root, mode),
  };
  const endpoint = path.split('/').at(-1);
  assert.ok(endpoint && Object.hasOwn(handlers, endpoint));
  return handlers[endpoint]();
}
function response(url: URL, init: RequestInit | undefined, mode: Mode, root: string) {
  const method = init?.method ?? 'GET';
  assert.equal(url.origin, 'https://api.cloudflare.com');
  assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer DO-NOT-PRINT-TOKEN');
  if (mode.denied)
    return Response.json({ errors: [{ message: 'DO-NOT-PRINT-BODY' }] }, { status: 403 });
  if (url.pathname.endsWith('/query')) {
    assert.equal(method, 'POST');
    assert.ok(typeof init?.body === 'string');
    assert.deepEqual(JSON.parse(init.body), { sql: 'SELECT name FROM d1_migrations ORDER BY id' });
  } else assert.equal(method, 'GET');
  return Response.json({
    success: true,
    result: metadata(url, mode, root),
    result_info: {
      page: Number(url.searchParams.get('page') ?? 1),
      total_pages: mode.paginatedBypass && url.pathname.endsWith('/policies') ? 2 : 1,
    },
  });
}
export function cloudflareFixture(mode: Mode = {}) {
  const root = resolve(import.meta.dirname, '../../../..');
  const requests: { url: URL; method: string }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push({ url, method: init?.method ?? 'GET' });
    return Promise.resolve(response(url, init, mode, root));
  };
  return {
    requests,
    options: { root, accountId: 'test-account', token: 'DO-NOT-PRINT-TOKEN', fetch: fetcher },
  };
}
