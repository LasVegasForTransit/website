import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { assertAuthenticatedReport, measureRouteJavaScript } from '../scripts/audit/budgets';

const origin = 'https://staff.example.invalid';
const load = (files: Record<string, string | undefined>) => (url: string) => {
  const body = files[new URL(url).pathname];
  assert.ok(body !== undefined, `unexpected script ${url}`);
  return Promise.resolve({ body, status: 200, url });
};

void test('route budget counts inline code and imported scripts once, including cycles', async () => {
  const files = {
    '/entry.js': "import './shared.js'; export { value } from './shared.js'; import('./lazy.js');",
    '/shared.js': "import './entry.js'; export const value = 42;",
    '/lazy.js': "import './shared.js'; console.log('loaded');",
  };
  const inline = "console.log('inline');";
  const result = await measureRouteJavaScript({
    url: `${origin}/people/`,
    scripts: [{ src: '/entry.js' }, { code: inline }],
    modulePreloads: ['/shared.js'],
    load: load(files),
  });
  assert.equal(
    result.gzipBytes,
    Object.values(files).reduce((n, code) => n + gzipSync(code).length, gzipSync(inline).length),
  );
  assert.equal(result.externalScripts, 3);
  assert.equal(result.inlineScripts, 1);
});

void test('a route fails the 35 KB gzip budget even when the browser CSP would block its script', async () => {
  const payload = Array.from(randomBytes(45_000), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const code = `const payload = '${payload}';`;
  await assert.rejects(
    measureRouteJavaScript({
      url: `${origin}/people/`,
      scripts: [{ src: '/large.js' }],
      modulePreloads: [],
      load: load({ '/large.js': code }),
    }),
    /35 KB gzip/,
  );
});

void test('scripts cannot disappear from the budget through redirects, errors or external imports', async () => {
  const base = { url: `${origin}/people/`, scripts: [{ src: '/entry.js' }], modulePreloads: [] };
  await assert.rejects(
    measureRouteJavaScript({
      ...base,
      load: (url) => Promise.resolve({ url, status: 403, body: '' }),
    }),
    /script response/,
  );
  await assert.rejects(
    measureRouteJavaScript({
      ...base,
      load: () => Promise.resolve({ url: `${origin}/sign-in/`, status: 200, body: '' }),
    }),
    /script redirect/,
  );
  await assert.rejects(
    measureRouteJavaScript({
      ...base,
      load: load({ '/entry.js': "import 'https://outside.example.invalid/script.js';" }),
    }),
    /external script/,
  );
});

void test('Lighthouse must report the authenticated staff page, not a redirect or refusal at the same URL', () => {
  const requestedUrl = `${origin}/people/`;
  const report = {
    requestedUrl,
    finalDisplayedUrl: requestedUrl,
    audits: {
      'network-requests': {
        score: 1,
        details: { items: [{ url: requestedUrl, resourceType: 'Document', statusCode: 200 }] },
      },
    },
  };
  assert.doesNotThrow(() => assertAuthenticatedReport(report, requestedUrl));
  assert.throws(
    () =>
      assertAuthenticatedReport(
        { ...report, finalDisplayedUrl: `${origin}/sign-in/` },
        requestedUrl,
      ),
    /authenticated route/,
  );
  assert.throws(
    () =>
      assertAuthenticatedReport(
        {
          ...report,
          audits: {
            'network-requests': {
              score: 1,
              details: {
                items: [{ url: requestedUrl, resourceType: 'Document', statusCode: 403 }],
              },
            },
          },
        },
        requestedUrl,
      ),
    /successful HTTP response/,
  );
  assert.throws(
    () =>
      assertAuthenticatedReport(
        { ...report, runtimeError: { code: 'FAILED_DOCUMENT_REQUEST' } },
        requestedUrl,
      ),
    /runtime error/,
  );
});
