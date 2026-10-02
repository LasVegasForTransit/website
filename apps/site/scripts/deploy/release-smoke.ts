import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { accessCredentials, accessFetch, accessHeaders } from './access-auth';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    'release-id': { type: 'string' },
    commit: { type: 'string' },
    protected: { type: 'boolean', default: false },
  },
});
if (!values.url) throw new Error('Pass --url with an HTTPS origin.');
const parsed = new URL(values.url);
if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash)
  throw new Error('Pass an HTTPS origin without a path.');
const origin = parsed.origin;
const credentials = values.protected ? accessCredentials(process.env) : undefined;
if (values.protected && !credentials)
  throw new Error('Protected staging verification requires Access credentials.');
if (values.protected) {
  const anonymous = await accessFetch(`${origin}/`, origin);
  assert.ok(
    [302, 401, 403].includes(anonymous.status),
    `Anonymous request reached staging (${anonymous.status}).`,
  );
}
if (values['release-id'] || values.commit) {
  const marker = await accessFetch(`${origin}/lvbt-release.json`, origin, credentials);
  assert.equal(marker.status, 200, 'Release marker is unavailable or Access rejected credentials.');
  const identity: unknown = await marker.json();
  assert.deepEqual(identity, { commit: values.commit, releaseId: values['release-id'] });
}
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    const headers = accessHeaders(route.request().url(), origin, credentials);
    if (Object.keys(headers).length === 0) return route.continue();
    const response = await route.fetch({
      headers: { ...route.request().headers(), ...headers },
      maxRedirects: 0,
    });
    await route.fulfill({ response });
  });
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
  assert.match(await page.title(), /Las Vegas|LVBT/i);
  assert.ok(await page.locator('main').isVisible(), 'The website main content is not visible.');
  if (values.protected) {
    assert.equal(response.headers()['x-robots-tag'], 'noindex, nofollow, noarchive');
    assert.deepEqual(analyticsRequests, [], 'Preview sent production analytics.');
  }
  process.stdout.write(
    `PASS: rendered ${origin}${values['release-id'] ? `, release ${values['release-id']}` : ''}\n`,
  );
} finally {
  await browser.close();
}
