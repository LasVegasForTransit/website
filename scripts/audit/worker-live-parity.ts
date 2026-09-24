import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const comparedHeaders = [
  'content-security-policy',
  'permissions-policy',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
] as const;

function mediaType(response: Response): string | null {
  return response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? null;
}

function htmlMetadata(html: string): { canonical: string | null; title: string | null } {
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const canonical =
    /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i.exec(html)?.[1] ??
    /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i.exec(html)?.[1] ??
    null;
  return { canonical, title };
}

const analyticsSignatures = [
  'static.cloudflareinsights.com/beacon.min.js',
  'events.lasvegasfortransit.org',
];

export async function pageIncludesAnalytics(
  html: string,
  loadScript: (pathname: string) => Promise<string> = () => Promise.resolve(''),
): Promise<boolean> {
  if (analyticsSignatures.some((signature) => html.includes(signature))) return true;

  const scriptPaths = [...html.matchAll(/<script\s+[^>]*src=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter((pathname): pathname is string => pathname?.startsWith('/') === true);
  const scripts = await Promise.all(scriptPaths.map(loadScript));
  return scripts.some((script) =>
    analyticsSignatures.some((signature) => script.includes(signature)),
  );
}

export async function compareResponses(
  pathname: string,
  reference: Response,
  candidate: Response,
): Promise<string[]> {
  const differences: string[] = [];
  if (reference.status !== candidate.status)
    differences.push(
      `${pathname}: status differs (Pages ${reference.status}, Worker ${candidate.status})`,
    );

  if (reference.headers.get('location') !== candidate.headers.get('location'))
    differences.push(`${pathname}: redirect location differs`);

  if (
    (reference.status < 300 || reference.status >= 400) &&
    mediaType(reference) !== mediaType(candidate)
  )
    differences.push(`${pathname}: content type differs`);

  for (const header of comparedHeaders) {
    if (reference.headers.get(header) !== candidate.headers.get(header))
      differences.push(`${pathname}: ${header} differs`);
  }

  if (mediaType(reference) === 'text/html' && mediaType(candidate) === 'text/html') {
    const referenceMetadata = htmlMetadata(await reference.text());
    const candidateMetadata = htmlMetadata(await candidate.text());
    if (referenceMetadata.title !== candidateMetadata.title)
      differences.push(`${pathname}: title differs`);
    if (referenceMetadata.canonical !== candidateMetadata.canonical)
      differences.push(`${pathname}: canonical URL differs`);
  }

  return differences;
}

export function parityCases(includeApis = true): Array<{ method?: string; pathname: string }> {
  const cases: Array<{ method?: string; pathname: string }> = [
    { pathname: '/' },
    { pathname: '/about/' },
    { pathname: '/not-a-real-page' },
    { pathname: '/get-involved' },
    { pathname: '/sitemap.xml' },
    { pathname: '/week-without-driving' },
    { pathname: '/projects/social-media-just-talking' },
  ];
  if (includeApis)
    cases.push(
      { pathname: '/api/membership-intake', method: 'POST' },
      { pathname: '/api/transit-news-intake', method: 'POST' },
    );
  return cases;
}

function origin(value: string | undefined, option: string): string {
  if (!value) throw new Error(`Pass ${option} with an HTTPS origin.`);
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash)
    throw new Error(`${option} must be an HTTPS origin without a path.`);
  return parsed.origin;
}

async function firstCalendarPath(): Promise<string> {
  const names = await readdir(path.join(process.cwd(), 'dist', 'events'));
  const name = names.find((candidate) => candidate.endsWith('.ics'));
  if (!name) throw new Error('The production build contains no calendar artifact.');
  return `/events/${name}`;
}

async function request(originValue: string, pathname: string, method = 'GET'): Promise<Response> {
  return fetch(`${originValue}${pathname}`, {
    method,
    body: method === 'POST' ? '{}' : undefined,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    redirect: 'manual',
  });
}

async function run(): Promise<void> {
  const { values } = parseArgs({
    options: {
      json: { type: 'boolean', default: false },
      pages: { type: 'string' },
      'skip-api': { type: 'boolean', default: false },
      'skip-analytics': { type: 'boolean', default: false },
      worker: { type: 'string' },
    },
  });
  const pages = origin(values.pages, '--pages');
  const worker = origin(values.worker, '--worker');
  if (pages === worker) throw new Error('--pages and --worker must identify different origins.');

  const cases = parityCases(!values['skip-api']);
  cases.push({ pathname: await firstCalendarPath() });

  const differences: string[] = [];
  for (const testCase of cases) {
    const [reference, candidate] = await Promise.all([
      request(pages, testCase.pathname, testCase.method),
      request(worker, testCase.pathname, testCase.method),
    ]);
    differences.push(...(await compareResponses(testCase.pathname, reference, candidate)));
  }

  if (!values['skip-analytics']) {
    const [pagesHome, workerHome] = await Promise.all([
      request(pages, '/').then((response) => response.text()),
      request(worker, '/').then((response) => response.text()),
    ]);
    const [pagesAnalytics, workerAnalytics] = await Promise.all([
      pageIncludesAnalytics(pagesHome, async (pathname) => (await request(pages, pathname)).text()),
      pageIncludesAnalytics(workerHome, async (pathname) =>
        (await request(worker, pathname)).text(),
      ),
    ]);
    if (pagesAnalytics !== workerAnalytics) differences.push('/: analytics integration differs');
  }

  const result = { cases: cases.length, differences, ok: differences.length === 0, pages, worker };
  process.stdout.write(
    values.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${result.ok ? 'PASS' : 'FAIL'}: ${cases.length} live parity checks\n`,
  );
  if (!result.ok) {
    if (!values.json)
      for (const difference of differences) process.stderr.write(`- ${difference}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
