import assert from 'node:assert/strict';
import { test } from 'node:test';

const environment = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_API_TOKEN: 'fixture-private-token',
};
const labels = ['bindings', 'routes', 'custom-domains', 'subdomain', 'environment', 'schedules'];
const paths = [
  '/workers/services/lvbt-website/environments/production/bindings',
  '/workers/services/lvbt-website/environments/production/routes?show_zonename=true',
  '/workers/domains/records?page=0&per_page=5&service=lvbt-website&environment=production',
  '/workers/services/lvbt-website/environments/production/subdomain',
  '/workers/services/lvbt-website/environments/production',
  '/workers/scripts/lvbt-website/schedules',
];
const providerSecret = 'fixture-provider-binding-and-personal-data';
async function feature() {
  const module = await import('../scripts/deploy/inspect-website-metadata').catch(() => null);
  assert.ok(module, 'protected publication needs a sanitized fixed-resource metadata diagnostic');
  return module;
}

void test('successful dashboard custom-domain envelopes accept null errors without exposing records', async () => {
  const { runWebsiteMetadataDiagnostics } = await feature();
  const output: string[] = [];
  const exitCode = await runWebsiteMetadataDiagnostics(
    environment,
    (url) =>
      Promise.resolve(
        Response.json({
          success: true,
          errors: url.includes('/domains/records?') ? null : [],
          messages: null,
          result: [{ hostname: providerSecret }],
        }),
      ),
    (line) => output.push(line),
  );
  assert.equal(exitCode, 0);
  const reports = JSON.parse(output.join('')) as Array<{
    resource: string;
    success: boolean;
    errorCodes: number[];
  }>;
  assert.equal(reports.find(({ resource }) => resource === 'custom-domains')?.success, true);
  assert.deepEqual(reports.find(({ resource }) => resource === 'custom-domains')?.errorCodes, []);
  assert.doesNotMatch(output.join(''), /fixture|hostname|result|messages/);
});

void test('one GET per exact Wrangler resource isolates a denied route without retries or disclosure', async () => {
  const { inspectWebsiteMetadata } = await feature();
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const results = await inspectWebsiteMetadata(environment, async (url, options) => {
    await Promise.resolve();
    calls.push({ url, options });
    const denied = url.includes('/routes?');
    return Response.json(
      {
        success: !denied,
        errors: denied ? [{ code: 10000, message: providerSecret }, { code: 'secret-code' }] : [],
        result: { vars: providerSecret, token: environment.CLOUDFLARE_API_TOKEN },
        messages: [{ message: providerSecret }],
      },
      { status: denied ? 403 : 200 },
    );
  });
  assert.deepEqual(
    calls.map(({ url }) => url),
    paths.map(
      (path) =>
        `https://api.cloudflare.com/client/v4/accounts/${environment.CLOUDFLARE_ACCOUNT_ID}${path}`,
    ),
  );
  for (const { options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, {
      Authorization: `Bearer ${environment.CLOUDFLARE_API_TOKEN}`,
    });
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
  }
  assert.deepEqual(
    results,
    labels.map((resource) => ({
      resource,
      status: resource === 'routes' ? 403 : 200,
      success: resource !== 'routes',
      errorCodes: resource === 'routes' ? [10000] : [],
    })),
  );
  assert.doesNotMatch(
    JSON.stringify(results),
    /fixture-private-token|fixture-provider|secret-code|vars|Authorization|accounts\//,
  );
});

void test('redirects, transport failures and malformed bodies stay failures without following or echoing them', async () => {
  const { inspectWebsiteMetadata } = await feature();
  let calls = 0;
  const results = await inspectWebsiteMetadata(environment, async () => {
    await Promise.resolve();
    const index = calls++;
    if (index === 0)
      return new Response(providerSecret, {
        status: 302,
        headers: { Location: `https://${providerSecret}.invalid` },
      });
    if (index === 1) throw new Error(`${providerSecret} ${environment.CLOUDFLARE_API_TOKEN}`);
    if (index === 2) return new Response(providerSecret, { status: 200 });
    if (index === 3) return Response.json(null);
    if (index === 4) return Response.json({ success: 'true', errors: [], result: providerSecret });
    return Response.json({ success: false, errors: [{ code: 10013, message: providerSecret }] });
  });
  assert.equal(calls, 6);
  assert.deepEqual(
    results.map(({ status }) => status),
    [302, null, 200, 200, 200, 200],
  );
  assert.equal(
    results.every(({ success }) => !success),
    true,
  );
  assert.deepEqual(results[5]?.errorCodes, [10013]);
  assert.doesNotMatch(
    JSON.stringify(results),
    /fixture-private-token|fixture-provider|https:|Error|Location/,
  );
});

void test('an aborted request is reported without repeating it or leaking its reason', async () => {
  const { inspectWebsiteMetadata } = await feature();
  let calls = 0;
  const results = await inspectWebsiteMetadata(environment, () => {
    calls++;
    return Promise.reject(new DOMException(providerSecret, 'TimeoutError'));
  });
  assert.equal(calls, 6);
  assert.equal(
    results.every(
      ({ status, success, errorCodes }) => status === null && !success && errorCodes.length === 0,
    ),
    true,
  );
});

void test('missing or malformed protected configuration fails before any HTTP request', async () => {
  const { inspectWebsiteMetadata } = await feature();
  let calls = 0;
  const request = () => {
    calls++;
    return Promise.resolve(Response.json({ success: true, errors: [] }));
  };
  for (const input of [
    {},
    { CLOUDFLARE_ACCOUNT_ID: environment.CLOUDFLARE_ACCOUNT_ID },
    { ...environment, CLOUDFLARE_API_TOKEN: '  ' },
    { ...environment, CLOUDFLARE_API_TOKEN: `${providerSecret}\n` },
    { ...environment, CLOUDFLARE_ACCOUNT_ID: 'https://unapproved.invalid' },
  ])
    await assert.rejects(inspectWebsiteMetadata(input, request), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /CLOUDFLARE_ACCOUNT_ID.*CLOUDFLARE_API_TOKEN/);
      assert.doesNotMatch(error.message, /fixture|unapproved/);
      return true;
    });
  assert.equal(calls, 0);
});

void test('CLI emits only the projected diagnostics and returns nonzero on any failed resource', async () => {
  const { runWebsiteMetadataDiagnostics } = await feature();
  const output: string[] = [];
  let calls = 0;
  const exitCode = await runWebsiteMetadataDiagnostics(
    environment,
    async () => {
      await Promise.resolve();
      calls++;
      return Response.json(
        {
          success: calls !== 3,
          errors: calls === 3 ? [{ code: 10000, message: providerSecret }] : [],
          result: providerSecret,
        },
        { status: calls === 3 ? 403 : 200 },
      );
    },
    (line) => output.push(line),
  );
  assert.equal(exitCode, 1);
  assert.equal(calls, 6);
  const reports: unknown = JSON.parse(output.join(''));
  assert.ok(Array.isArray(reports));
  assert.equal(reports.length, 6);
  for (const report of reports)
    assert.deepEqual(Object.keys(report as object).sort(), [
      'errorCodes',
      'resource',
      'status',
      'success',
    ]);
  assert.doesNotMatch(output.join(''), /fixture|Authorization|https:|result|message|token/);
  assert.equal(
    await runWebsiteMetadataDiagnostics(
      environment,
      () => Promise.resolve(Response.json({ success: true, errors: [] })),
      () => undefined,
    ),
    0,
  );
});

void test('CLI missing-configuration output is constant and never reaches HTTP', async () => {
  const { runWebsiteMetadataDiagnostics } = await feature();
  const output: string[] = [];
  let calls = 0;
  assert.equal(
    await runWebsiteMetadataDiagnostics(
      { CLOUDFLARE_API_TOKEN: providerSecret },
      () => {
        calls++;
        return Promise.reject(new Error(providerSecret));
      },
      (line) => output.push(line),
    ),
    1,
  );
  assert.equal(calls, 0);
  assert.equal(output.length, 1);
  assert.match(output.join(''), /CLOUDFLARE_ACCOUNT_ID.*CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(output.join(''), /fixture/);
});
