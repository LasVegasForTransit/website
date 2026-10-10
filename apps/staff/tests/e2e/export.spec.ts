import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate/browser';
import { ORIGIN, startRuntime } from '../support/runtime';
const fixture = await startRuntime();
const browser = await chromium
  .launch({
    args: [
      `--host-resolver-rules=MAP staff.lasvegasfortransit.org 127.0.0.1:${fixture.port}`,
      '--no-proxy-server',
    ],
  })
  .catch(async (error: unknown) => {
    await fixture.dispose();
    throw error;
  });
try {
  const headers = {
    'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
    Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
    Origin: ORIGIN,
  };
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': fixture.admin.assertion },
    serviceWorkers: 'block',
  });
  await context.addCookies([
    {
      name: '__Host-lvbt_session',
      value: fixture.admin.session.token,
      url: ORIGIN,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await context.route('**/*', async (route) => {
    assert.equal(new URL(route.request().url()).origin, ORIGIN);
    await route.continue();
  });
  const page = await context.newPage();
  const initial = await page.goto(`${ORIGIN}/export/`);
  assert.equal(initial?.status(), 200);
  const token = await page.locator('form[action="/export/"] input[name=token]').inputValue();
  const started = performance.now();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download records', exact: true }).click(),
  ]);
  const directory = join(fixture.root, 'test-results/staff');
  await mkdir(directory, { recursive: true });
  const artifact = join(directory, 'member-export-fixture.zip');
  await download.saveAs(artifact);
  assert.equal(await download.failure(), null);
  const elapsed = Math.round(performance.now() - started);
  assert.ok(elapsed < 30000, 'the local 5000-person export must finish in 30 seconds');
  const files = unzipSync(await readFile(artifact));
  const data = JSON.parse(strFromU8(files['export.json'] ?? new Uint8Array())) as {
    people: { id: string }[];
    consent_records: unknown[];
  };
  assert.ok(data.people.length >= 5000);
  assert.ok(data.consent_records.length >= 5000);
  assert.deepEqual(Object.keys(files).sort(), [
    'README.txt',
    'consent_records.csv',
    'engagement_events.csv',
    'export.json',
    'identities.csv',
    'people.csv',
  ]);
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='people.export'")
        .first()
    )?.n,
    1,
  );
  const replay = await fixture.simulator.dispatchFetch(`${ORIGIN}/export/`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  });
  assert.equal(replay.status, 409);
  const external = await fixture.simulator.dispatchFetch(`${ORIGIN}/export/`, {
    method: 'POST',
    headers: { ...headers, Origin: 'https://elsewhere.example.invalid' },
    body: new URLSearchParams({ token }).toString(),
  });
  assert.equal(external.status, 403);
  const denied = await fixture.simulator.dispatchFetch(`${ORIGIN}/export/`, {
    headers: {
      'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
      Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
    },
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.text()).includes('example.invalid'), false);
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='people.export'")
        .first()
    )?.n,
    1,
  );
  await context.close();
  console.log(
    JSON.stringify({
      runtime: 'compiled HTTPS staff Worker',
      javaScript: false,
      syntheticPeople: data.people.length,
      localExportMs: elapsed,
      checks: [
        'native administrator archive download',
        'complete consent records',
        'one-use forms',
        'same-origin enforcement',
        'lead denial',
        'attributed export audit',
      ],
      artifact,
    }),
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
