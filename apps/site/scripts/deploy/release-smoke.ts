import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Page } from '@playwright/test';
import { validateWorkerSmokeOrigin } from '@lasvegasfortransit/web-platform/release';
import { releaseConfiguration } from './release-config';
import {
  accessCredentials,
  accessFetch,
  accessRequestOptions,
  type AccessCredentials,
} from './access-auth';
import {
  readReleaseIdentity,
  waitForReleaseIdentity,
  type ReleaseIdentity,
} from './release-identity';
import {
  ACTIVATED_SMOKE_LIMIT,
  ACTIVATION_MARKER_LIMIT,
  ACTIVATION_MARKER_WAIT_MS,
  CANDIDATE_SMOKE_LIMIT,
  boundHostedBrowserRequests,
  createHostedRequestBudget,
} from './hosted-request-budget';

interface SmokeOptions {
  origin: string;
  expected?: ReleaseIdentity;
  protected: boolean;
  public: boolean;
  waitForPropagation: boolean;
  credentials?: AccessCredentials;
}

async function verifySmokeIdentity(options: SmokeOptions, claim: () => void): Promise<void> {
  const { origin, credentials } = options;
  let markerReads = 0;
  const identityOptions = {
    ...(credentials ? { credentials } : {}),
    request: (url: string, init: Parameters<typeof fetch>[1]) => {
      assert.ok(
        markerReads < (options.waitForPropagation ? ACTIVATION_MARKER_LIMIT : 1),
        'Release marker allowance exhausted.',
      );
      markerReads += 1;
      claim();
      return fetch(url, init);
    },
  };
  if (options.expected)
    await waitForReleaseIdentity(origin, options.expected, {
      ...identityOptions,
      timeoutMs: options.waitForPropagation ? ACTIVATION_MARKER_WAIT_MS : 0,
      intervalMs: 4_500,
    });
  else await readReleaseIdentity(origin, identityOptions);
}

async function checkSmokePage(
  page: Page,
  options: SmokeOptions,
  request: (url: string) => Promise<Response>,
  failures: string[],
): Promise<void> {
  const { origin } = options;
  const analyticsRequests: string[] = [];
  page.on('request', (request) => {
    if (
      /cloudflareinsights\.com|events\.lasvegasfortransit\.org/.test(
        new URL(request.url()).hostname,
      )
    )
      analyticsRequests.push(request.url());
  });
  page.on('response', (response) => {
    if (
      new URL(response.url()).origin === origin &&
      response.request().resourceType() !== 'document' &&
      !response.ok()
    )
      failures.push(`Asset returned ${response.status()}.`);
  });
  const response = await page.goto(origin, { waitUntil: 'networkidle' });
  assert.equal(response?.status(), 200, 'The website did not render.');
  assert.equal(new URL(page.url()).origin, origin, 'Browser was redirected away from the website.');
  assert.match(await page.title(), /Las Vegans for Better Transit|Las Vegas|LVBT/i);
  assert.ok(await page.locator('main').isVisible(), 'The website main content is not visible.');
  if (options.public) {
    assert.equal(
      origin,
      'https://lasvegasfortransit.org',
      'Public checks require the production origin.',
    );
    const nested = await request(`${origin}/colophon/`);
    assert.equal(nested.status, 200, 'A nested production route did not render.');
    assert.match(await nested.text(), /<main[\s>]/);
    const canonical = await request('https://www.lasvegasfortransit.org/colophon/');
    assert.ok([301, 302, 303, 307, 308].includes(canonical.status), 'www did not redirect.');
    assert.equal(
      new URL(canonical.headers.get('location') ?? '', 'https://www.lasvegasfortransit.org').href,
      `${origin}/colophon/`,
      'www did not redirect to the canonical nested route.',
    );
  }
  if (options.protected) {
    const robots = new URL(origin).hostname.endsWith('.workers.dev')
      ? 'noindex'
      : 'noindex, nofollow, noarchive';
    assert.equal(response.headers()['x-robots-tag'], robots);
    assert.equal(response.headers()['cache-control'], 'private, no-store');
    assert.deepEqual(analyticsRequests, [], 'Preview sent production analytics.');
  }
  assert.deepEqual(failures, []);
}

export async function verifyReleaseSmoke(options: SmokeOptions) {
  const { origin, credentials } = options;
  const budget = createHostedRequestBudget(
    options.waitForPropagation ? ACTIVATED_SMOKE_LIMIT : CANDIDATE_SMOKE_LIMIT,
  );
  const claim = () => assert.ok(budget.claim(), 'Smoke exceeded its hosted request allowance.');
  const request = (url: string, authenticated = true) => {
    claim();
    return accessFetch(url, origin, authenticated ? credentials : undefined);
  };
  if (options.protected) {
    const anonymous = await request(`${origin}/`, false);
    assert.ok(
      [302, 401, 403].includes(anonymous.status),
      `Anonymous request reached staging (${anonymous.status}).`,
    );
  }
  await verifySmokeIdentity(options, claim);
  const browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const failures: string[] = [];
  try {
    await boundHostedBrowserRequests(
      context,
      {
        fetch: (url, init) => {
          const absolute = typeof url === 'string' ? url : url.url();
          const authentication = accessRequestOptions(absolute, origin, credentials);
          return context.request.fetch(absolute, {
            ...init,
            ...authentication,
            headers: { ...init?.headers, ...authentication.headers },
          });
        },
      },
      budget,
      { failures, allowedMethods: ['GET', 'POST', 'OPTIONS'] },
    );
    await checkSmokePage(page, options, request, failures);
    return budget.report();
  } finally {
    await page.close();
    await context.unrouteAll({ behavior: 'wait' });
    await browser.close();
    const report = budget.report();
    process.stdout.write(
      `Smoke requests: ${report.sent}/${report.limit}; ${report.blocked} blocked.\n`,
    );
    assert.equal(report.blocked, 0, 'Smoke exceeded its hosted request allowance.');
  }
}

function requestedIdentity(commit?: string, releaseId?: string): ReleaseIdentity | undefined {
  if (!commit && !releaseId) return undefined;
  if (!commit || !releaseId) throw new Error('Pass both --commit and --release-id.');
  return { commit, releaseId };
}

async function run(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      'release-id': { type: 'string' },
      commit: { type: 'string' },
      protected: { type: 'boolean', default: false },
      'wait-for-propagation': { type: 'boolean', default: false },
      public: { type: 'boolean', default: false },
    },
  });
  if (!values.url) throw new Error('Pass --url with an HTTPS origin.');
  const parsed = new URL(values.url);
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash)
    throw new Error('Pass an HTTPS origin without a path.');
  const origin = parsed.origin;
  validateWorkerSmokeOrigin(origin, releaseConfiguration, values.protected);
  const credentials = values.protected ? accessCredentials(process.env) : undefined;
  if (values.protected && !credentials)
    throw new Error('Protected staging verification requires Access credentials.');
  const expected = requestedIdentity(values.commit, values['release-id']);
  await verifyReleaseSmoke({
    origin,
    protected: values.protected,
    public: values.public,
    waitForPropagation: values['wait-for-propagation'],
    ...(credentials ? { credentials } : {}),
    ...(expected ? { expected } : {}),
  });
  process.stdout.write(
    `PASS: rendered ${origin}${values['release-id'] ? `, release ${values['release-id']}` : ''}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
