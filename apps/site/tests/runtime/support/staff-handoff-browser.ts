import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { chromium } from '@playwright/test';
import { ACCOUNT_ORIGIN, type accountDataRuntime } from './account-data-runtime';

export async function approveHandoffInBrowser(
  fixture: Awaited<ReturnType<typeof accountDataRuntime>>,
  url: string,
) {
  const failures: unknown[] = [];
  const server = createServer(fixture.tls, (request, response) => {
    try {
      assert.equal(
        request.headers.host,
        'staff.lasvegasfortransit.org',
        'unexpected browser destination',
      );
      assert.equal(request.url, '/sign-in/link-account/');
      assert.equal(request.method, 'GET');
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<h1>Staff Portal reached</h1>');
    } catch (error) {
      failures.push(error);
      response.writeHead(500);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const browser = await chromium.launch({
    args: [
      `--host-resolver-rules=MAP preview.lasvegasfortransit.org 127.0.0.1:${fixture.port}, MAP * 127.0.0.1:${port}`,
      '--no-proxy-server',
    ],
  });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: true });
    await context.addCookies([
      {
        name: '__Host-lvbt_session',
        value: fixture.session.token,
        url: ACCOUNT_ORIGIN,
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    await page.goto(url);
    const submission = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).origin === ACCOUNT_ORIGIN,
    );
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const approved = await submission;
    assert.equal(
      approved.request().headers().origin,
      ACCOUNT_ORIGIN,
      'native member POST must retain its same-origin Origin header',
    );
    assert.equal(approved.status(), 303);
    await page.getByRole('heading', { name: 'Staff Portal reached', exact: true }).waitFor();
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.deepEqual(failures, []);
  }
}
