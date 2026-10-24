import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { createServer } from 'node:https';
import type { ServerResponse, IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ORIGIN, type startRuntime } from '../../support/runtime';

export type Flow = 'existing' | 'create' | 'member' | 'handoff' | 'change';
export type Mode = 'cloudflare-access' | 'google';
export function navigationFlow(flow: Flow): flow is 'handoff' | 'change' {
  return ['handoff', 'change'].includes(flow);
}
type Fixture = Pick<Awaited<ReturnType<typeof startRuntime>>, 'simulator' | 'tls'>;
async function portalResponse(
  request: IncomingMessage,
  response: ServerResponse,
  fixture: Fixture,
  url: URL,
) {
  if (url.pathname === '/cdn-cgi/access/logout') {
    response.writeHead(303, {
      Location: 'https://lvbt.cloudflareaccess.com/cdn-cgi/access/logout',
    });
    response.end();
    return;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers))
    if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  const result = await fixture.simulator.dispatchFetch(url.href, {
    method: request.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks).toString() : undefined,
    redirect: 'manual',
  });
  response.statusCode = result.status;
  for (const [name, value] of result.headers)
    if (!['set-cookie', 'content-length'].includes(name)) response.setHeader(name, value);
  response.setHeader('Set-Cookie', result.headers.getSetCookie());
  response.end(Buffer.from(await result.arrayBuffer()));
}
export async function navigationRuntime(
  fixture: Fixture,
  flow: Flow,
  mode: Mode,
  authorize: (url: URL) => string,
) {
  const failures: unknown[] = [];
  async function respond(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', `https://${request.headers.host}`);
    if (url.origin === ORIGIN) return portalResponse(request, response, fixture, url);
    if (url.origin === 'https://accounts.google.com') {
      assert.equal(mode, 'google');
      if (flow !== 'change' || url.searchParams.get('prompt') !== 'select_account') {
        response.writeHead(303, { Location: authorize(url) });
        response.end();
        return;
      }
    } else if (url.origin === 'https://lasvegasfortransit.org') {
      assert.equal(flow, 'handoff');
      assert.equal(url.pathname, '/sign-in/staff-link/');
      assert.ok(url.searchParams.get('request'));
    } else {
      assert.equal(
        url.origin,
        'https://lvbt.cloudflareaccess.com',
        'browser traffic must remain in the local transport',
      );
      assert.equal(flow, 'change');
      assert.equal(mode, 'cloudflare-access');
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(
      `<h1>${flow === 'handoff' ? 'Member site reached' : 'Account chooser reached'}</h1>`,
    );
  }
  // All browser DNS names map here, including redirect hops that Playwright does
  // not route again. Only the compiled portal and these fictional providers run.
  const server = createServer(fixture.tls, (request, response) => {
    void respond(request, response).catch((error: unknown) => {
      failures.push(error);
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    dispose: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      assert.deepEqual(failures, []);
    },
  };
}
export async function navigationJourney(
  page: Page,
  flow: 'handoff' | 'change',
  cspErrors: string[],
  mode: Mode,
) {
  await page
    .getByRole('button', {
      name: flow === 'handoff' ? 'Use my signed-in member account' : 'Change account',
      exact: true,
    })
    .click();
  await page
    .getByRole('heading', {
      name: flow === 'handoff' ? 'Member site reached' : 'Account chooser reached',
      exact: true,
    })
    .waitFor();
  assert.equal(cspErrors.length, 0, cspErrors.join('\n'));
  console.log(`${mode}: ${flow} browser navigation passed without CSP violations.`);
}

export function accessHeaders(mode: Mode, assertion: string) {
  return mode === 'cloudflare-access'
    ? { extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': assertion } }
    : {};
}

export async function faviconPreservesSetup(page: Page) {
  const result = await page.evaluate(async () => {
    const response = await fetch('/favicon.ico');
    return { status: response.status, path: new URL(response.url).pathname };
  });
  assert.deepEqual(
    result,
    { status: 401, path: '/favicon.ico' },
    'a background favicon request must not start another sign-in',
  );
  await page.reload();
  await page.getByRole('heading', { name: 'Check your email', exact: true }).waitFor();
}
