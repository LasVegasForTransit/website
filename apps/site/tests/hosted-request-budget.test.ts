import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import {
  boundHostedBrowserRequests,
  createHostedRequestBudget,
  HOSTED_REQUEST_LIMIT,
  HOSTED_ACCEPTANCE_LIMIT,
  CANDIDATE_SMOKE_LIMIT,
  ACTIVATED_SMOKE_LIMIT,
} from '../scripts/deploy/hosted-request-budget';

void test('all publication verification stages fit one 116-request allowance', () => {
  assert.equal(HOSTED_REQUEST_LIMIT, 116);
  assert.equal(HOSTED_ACCEPTANCE_LIMIT + CANDIDATE_SMOKE_LIMIT + ACTIVATED_SMOKE_LIMIT, 116);
});

void test('hosted requests stop at the selected stage allowance', () => {
  const budget = createHostedRequestBudget();
  for (let request = 0; request < 64; request += 1) assert.equal(budget.claim(), true);
  for (let request = 0; request < 10; request += 1) assert.equal(budget.claim(), false);
  assert.deepEqual(budget.report(), { limit: 64, sent: 64, blocked: 10 });
  for (const limit of [0, -1, Infinity, 117]) assert.throws(() => createHostedRequestBudget(limit));
});

void test('browser routing enforces the outgoing ceiling and stops redirect chains', async () => {
  const received: string[] = [];
  const server = createServer((request, response) => {
    received.push(request.url ?? '/');
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/must-not-follow' });
      response.end();
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end(
      request.url === '/burst'
        ? `<html><body>${Array.from({ length: 110 }, (_, i) => `<img src="/image-${i}">`).join('')}</body></html>`
        : '',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const budget = createHostedRequestBudget();
    assert.equal(budget.claim(), true, 'Reserve the independently requested release marker.');
    await boundHostedBrowserRequests(context, context.request, budget, { failures: [] });
    const page = await context.newPage();
    await page.goto(`${origin}/burst`, { waitUntil: 'networkidle' });
    assert.equal(budget.report().sent, 64);
    assert.ok(budget.report().blocked > 0);
    assert.equal(received.length, 63, 'The marker reservation leaves 63 actual browser fetches.');
    await context.close();

    const redirectContext = await browser.newContext();
    const failures: string[] = [];
    await boundHostedBrowserRequests(
      redirectContext,
      redirectContext.request,
      createHostedRequestBudget(),
      { failures },
    );
    const redirectPage = await redirectContext.newPage();
    await assert.rejects(redirectPage.goto(`${origin}/redirect`), /ERR_BLOCKED_BY_CLIENT/);
    assert.equal(received.includes('/must-not-follow'), false);
    assert.deepEqual(failures, ['Hosted acceptance encountered an unexpected redirect.']);
    await redirectContext.close();
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
