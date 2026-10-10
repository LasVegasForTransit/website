import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { scopeBrowserAccess } from '@lasvegasfortransit/web-platform/release';
import { releaseConfiguration } from './release-config';
import { verifyReleaseAccess } from './release-access';
import { waitForReleaseIdentity } from './release-identity';

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
const credentials = await verifyReleaseAccess(origin, releaseConfiguration, values);
if (values['release-id'] || values.commit) {
  if (!values.commit || !values['release-id'])
    throw new Error('Pass both --commit and --release-id.');
  await waitForReleaseIdentity(
    origin,
    { commit: values.commit, releaseId: values['release-id'] },
    {
      ...(credentials ? { credentials } : {}),
      timeoutMs: values['wait-for-propagation'] ? 180_000 : 0,
    },
  );
}
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await scopeBrowserAccess(context, origin, credentials);
  const page = await context.newPage();
  const analyticsRequests: string[] = [];
  page.on('request', (request) => {
    if (
      /cloudflareinsights\.com|events\.lasvegasfortransit\.org/.test(
        new URL(request.url()).hostname,
      )
    )
      analyticsRequests.push(request.url());
  });
  const response = await page.goto(origin, { waitUntil: 'networkidle' });
  assert.equal(response?.status(), 200, 'The website did not render.');
  assert.equal(new URL(page.url()).origin, origin, 'Browser was redirected away from the website.');
  assert.match(await page.title(), /Las Vegans for Better Transit|Las Vegas|LVBT/i);
  assert.ok(await page.locator('main').isVisible(), 'The website main content is not visible.');
  if (values.public) {
    const nested = await page.goto(`${origin}/colophon/`, { waitUntil: 'networkidle' });
    assert.equal(nested?.status(), 200, 'A nested production route did not render.');
    assert.ok(await page.locator('main').isVisible());
    await page.goto('https://www.lasvegasfortransit.org/colophon/', { waitUntil: 'networkidle' });
    assert.equal(
      page.url(),
      `${origin}/colophon/`,
      'www did not redirect to the canonical nested route.',
    );
  }
  if (credentials) {
    // Cloudflare overwrites this header on versioned workers.dev preview URLs.
    const robots = parsed.hostname.endsWith('.workers.dev')
      ? 'noindex'
      : 'noindex, nofollow, noarchive';
    assert.equal(response.headers()['x-robots-tag'], robots);
    assert.deepEqual(analyticsRequests, [], 'Preview sent production analytics.');
  }
  process.stdout.write(
    `PASS: rendered ${origin}${values['release-id'] ? `, release ${values['release-id']}` : ''}\n`,
  );
} finally {
  await browser.close();
}
