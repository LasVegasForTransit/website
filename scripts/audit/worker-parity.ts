import { spawn, type ChildProcess } from 'node:child_process';
import { readdir } from 'node:fs/promises';
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

  const api = await fetch(`${baseUrl}/api/subscribe`, {
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
    fail('The compiled /api/subscribe route did not execute in the Worker.');
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
