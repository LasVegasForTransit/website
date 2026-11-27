import { spawn, type ChildProcess } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const HOST = '127.0.0.1';

function fail(message: string): never {
  throw new Error(message);
}

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') fail('Could not reserve a local port.');
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForWorker(url: string, process: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (process.exitCode !== null) fail(`Wrangler exited with code ${process.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local socket is not accepting requests yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail('Wrangler did not become ready within 15 seconds.');
}

function expectHeader(response: Response, name: string, value?: string): void {
  const actual = response.headers.get(name);
  if (actual === null) fail(`Missing ${name} on ${response.url}.`);
  if (value !== undefined && actual !== value)
    fail(`Expected ${name}: ${value} on ${response.url}; received ${actual}.`);
}

async function expectPage(
  baseUrl: string,
  pathname: string,
  status: number,
  title: string,
): Promise<void> {
  const response = await fetch(`${baseUrl}${pathname}`);
  const html = await response.text();
  if (response.status !== status)
    fail(`Expected ${status} for ${pathname}; received ${response.status}.`);
  if (!html.includes(`<title>${title}`)) fail(`Unexpected page returned for ${pathname}.`);
  for (const header of [
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
  ])
    expectHeader(response, header);

  const policy = response.headers.get('content-security-policy') ?? '';
  if (!policy.includes("script-src 'self' 'wasm-unsafe-eval'"))
    fail(`The CSP on ${response.url} does not permit Pagefind WebAssembly.`);
  if (policy.includes("'unsafe-eval'"))
    fail(`The CSP on ${response.url} grants unrestricted script evaluation.`);
}

async function firstCalendarPath(root: string): Promise<string> {
  const directory = path.join(root, 'dist', 'events');
  const entries = await readdir(directory);
  const name = entries.find((entry) => entry.endsWith('.ics'));
  if (!name) fail('The production build contains no calendar artifact.');
  return `/events/${name}`;
}

async function expectIndexing(
  baseUrl: string,
  pathname: string,
  indexable: boolean,
): Promise<void> {
  const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'manual' });
  if (response.status !== 200)
    fail(`Expected direct 200 for ${pathname}; received ${response.status}.`);
  const html = await response.text();
  const expectedCanonical = `https://lasvegasfortransit.org${pathname}`;
  if (!html.includes(`<link rel="canonical" href="${expectedCanonical}"`))
    fail(`Expected self-canonical ${expectedCanonical}.`);
  // These public route families appeared in Search Console as redirecting links.
  for (const [, href] of html.matchAll(/<a\s+[^>]*href="([^"#]+)"/g)) {
    if (!href?.startsWith('/') || href.startsWith('//')) continue;
    const linked = new URL(href, baseUrl);
    const reportedRoute =
      /^\/(?:newsletter|join|projects|roadmap|letters|events)(?:\/|$)/.test(linked.pathname) ||
      linked.pathname === '/about/strategy';
    if (
      reportedRoute &&
      !linked.pathname.endsWith('/') &&
      !linked.pathname.split('/').at(-1)?.includes('.')
    )
      fail(`Link ${href} on ${pathname} skips its canonical trailing slash.`);
  }
  const noindex =
    /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html) ||
    (response.headers.get('x-robots-tag') ?? '').includes('noindex');
  if (noindex === indexable) fail(`Unexpected indexing policy for ${pathname}.`);
}

async function verifySitemap(baseUrl: string, root: string): Promise<void> {
  const sitemap = await readFile(path.join(root, 'dist', 'sitemap-0.xml'), 'utf8');
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
  if (urls.length === 0) fail('The sitemap contains no URLs.');
  for (const url of urls) {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://lasvegasfortransit.org' || !parsed.pathname.endsWith('/'))
      fail(`Unexpected sitemap URL: ${url}.`);
    if (parsed.pathname === '/qr/' || parsed.pathname.endsWith('.ics'))
      fail(`Utility URL appears in the sitemap: ${url}.`);
    await expectIndexing(baseUrl, parsed.pathname, true);
  }
  for (const pathname of [
    '/brand/',
    '/projects/faith-and-neighborhood-network/',
    '/join/member/',
  ]) {
    if (!urls.includes(`https://lasvegasfortransit.org${pathname}`))
      fail(`Expected ${pathname} in the sitemap.`);
  }
  await expectIndexing(baseUrl, '/qr/', false);

  const sitemapAlias = await fetch(`${baseUrl}/sitemap.xml`, { redirect: 'manual' });
  if (sitemapAlias.status !== 301 || sitemapAlias.headers.get('location') !== '/sitemap-index.xml')
    fail('The sitemap alias must redirect directly to /sitemap-index.xml.');
  const index = await fetch(`${baseUrl}/sitemap-index.xml`, { redirect: 'manual' });
  if (index.status !== 200 || !(await index.text()).includes('sitemap-0.xml'))
    fail('The primary sitemap index is unavailable.');
}

async function verifyEventRoutes(baseUrl: string, root: string): Promise<void> {
  const redirects = await readFile(path.join(root, 'public', '_redirects'), 'utf8');
  for (const line of redirects.split('\n')) {
    const [source, destination] = line.trim().split(/\s+/);
    if (!source?.startsWith('/events/') || !destination) continue;
    const response = await fetch(`${baseUrl}${source}`, { redirect: 'manual' });
    if (response.status !== 301 || response.headers.get('location') !== destination)
      fail(`Expected a direct event replacement for ${source}.`);
    await expectIndexing(baseUrl, destination, true);
  }

  // Missing Thursday occurrences are not proven replacements for the new Sunday series.
  // The board meeting was explicitly excluded in the calendar without a replacement.
  for (const pathname of [
    '/events/2026-07-09-lvbt-board-of-directors-meeting/',
    '/events/2026-10-08-lvbt-board-of-directors-meeting/',
    '/events/2026-09-10-lvbt-general-member-meeting/',
    '/events/2026-10-08-lvbt-general-member-meeting/',
    '/events/2027-01-14-lvbt-general-member-meeting/',
    '/events/2027-03-11-lvbt-general-member-meeting/',
    '/events/2027-05-13-lvbt-general-member-meeting/',
    '/events/2027-06-10-lvbt-general-member-meeting/',
    '/events/2027-07-08-lvbt-general-member-meeting/',
    '/events/2027-08-12-lvbt-general-member-meeting/',
    '/projects/peoples-rtc-dashboard',
    '/vision',
  ]) {
    const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'manual' });
    if (response.status !== 404) fail(`Expected retired route ${pathname} to remain 404.`);
  }
}

async function verify(baseUrl: string, root: string): Promise<void> {
  await expectPage(
    baseUrl,
    '/',
    200,
    'The transit movement Vegas needs — Las Vegans for Better Transit',
  );
  await expectPage(
    baseUrl,
    '/not-a-real-page',
    404,
    'Page not found — Las Vegans for Better Transit',
  );

  const redirect = await fetch(`${baseUrl}/get-involved`, { redirect: 'manual' });
  if (redirect.status !== 301 || redirect.headers.get('location') !== '/go')
    fail('The /get-involved redirect does not preserve its production contract.');

  const calendar = await fetch(`${baseUrl}${await firstCalendarPath(root)}`);
  expectHeader(calendar, 'content-type', 'text/calendar; charset=utf-8');
  expectHeader(calendar, 'x-robots-tag', 'noindex, nofollow');
  const invite = await calendar.text();
  if (
    calendar.status !== 200 ||
    !invite.includes('BEGIN:VCALENDAR') ||
    !invite.includes('BEGIN:VEVENT')
  )
    fail('The calendar download is not a usable event invite.');

  await verifySitemap(baseUrl, root);
  await verifyEventRoutes(baseUrl, root);

  const api = await fetch(`${baseUrl}/api/membership-intake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const apiBody: unknown = await api.json();
  if (
    api.status !== 503 ||
    typeof apiBody !== 'object' ||
    apiBody === null ||
    !('error' in apiBody) ||
    apiBody.error !== 'service_unavailable'
  )
    fail('The compiled /api/membership-intake route did not execute in the Worker.');
}

async function stop(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    process.once('exit', () => resolve());
    setTimeout(() => resolve(), 5_000).unref();
  });
}

async function main(): Promise<void> {
  const root = process.cwd();
  const port = await availablePort();
  const baseUrl = `http://${HOST}:${port}`;
  const wrangler = spawn('pnpm', ['exec', 'wrangler', 'dev', '--local', '--port', String(port)], {
    cwd: root,
    env: { ...process.env, WRANGLER_LOG: 'error' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  wrangler.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  wrangler.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  try {
    await waitForWorker(baseUrl, wrangler);
    await verify(baseUrl, root);
    process.stdout.write('Worker parity checks passed.\n');
  } catch (error) {
    process.stderr.write(output);
    throw error;
  } finally {
    await stop(wrangler);
  }
}

await main();
