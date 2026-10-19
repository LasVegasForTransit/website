import assert from 'node:assert/strict';
import test from 'node:test';
import { messageResponse, privateResponse } from '../src/lib/responses';

void test('staff failures remain usable without the database, scripts or asset requests', async () => {
  const response = privateResponse(messageResponse('Please return later.', 503));
  const html = await response.text();
  assert.equal(response.status, 503);
  assert.match(response.headers.get('Content-Type') ?? '', /text\/html/);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<main/);
  assert.match(html, /Las Vegans for Better Transit/);
  assert.match(html, /href="mailto:hello@lasvegasfortransit.org"/);
  assert.match(html, /href="https:\/\/lasvegasfortransit.org\/events\/"/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script|<link|<img/);
  assert.match(response.headers.get('Content-Security-Policy') ?? '', /style-src 'self' 'sha256-/);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

void test('staff messages escape markup and preserve their HTTP status', async () => {
  const response = messageResponse('<script>alert("private")</script>', 403);
  const html = await response.text();
  assert.equal(response.status, 403);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

void test('framework error responses cannot expose internal pages through the gateway', async () => {
  const { recoverStaffResponse } = await import('../src/lib/request-failure');
  for (const status of [404, 500, 503]) {
    const response = recoverStaffResponse(new Response('SQL private@example.invalid', { status }));
    const html = await response.text();
    assert.equal(response.status, status);
    assert.match(html, /<main/);
    assert.doesNotMatch(html, /SQL|private@example.invalid/);
  }
});

void test('operators can identify exhausted reads without logging exception contents', async () => {
  const { requestFailure, staffFailureCategory } = await import('../src/lib/request-failure');
  const { mock } = await import('node:test');
  const logger = mock.method(console, 'error', () => undefined);
  try {
    const cause = new Error("Your account has exceeded D1's free tier daily row read limit.");
    const error = new Error('SQL private@example.invalid', { cause });
    assert.equal(staffFailureCategory(error), 'database_read_limit');
    assert.equal(
      staffFailureCategory(
        new Error("Your account has exceeded D1's free tier daily row write limit."),
      ),
      'database_write_limit',
    );
    const response = requestFailure(error, 'middleware');
    assert.equal(response.status, 503);
    const visibleHtml = (await response.text()).replace(/<style>[\s\S]*?<\/style>/g, '');
    assert.doesNotMatch(visibleHtml, /SQL|private@example.invalid|D1/);
    const logged = JSON.stringify(logger.mock.calls);
    assert.match(logged, /database_read_limit/);
    assert.doesNotMatch(logged, /SQL|private@example.invalid|daily row read limit/);
  } finally {
    logger.mock.restore();
  }
});

void test('welcome conflicts keep a direct route back to the welcome list', async () => {
  const response = messageResponse('This welcome has changed.', 409, 'welcome');
  const html = await response.text();
  assert.match(html, /href="\/welcome\/">Back to welcome members/);
  assert.match(html, /<style>/);
  assert.equal(response.status, 409);
});
