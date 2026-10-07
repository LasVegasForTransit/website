import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { withLocalWorker } from './local-worker';

function fail(message: string): never {
  throw new Error(message);
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

await withLocalWorker(async (origin) => {
  await verify(origin, process.cwd());
  process.stdout.write('Worker parity checks passed.\n');
});
