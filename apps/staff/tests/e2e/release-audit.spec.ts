import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { authenticatedContext, auditPage } from './support/release-page';
import { auditSignIn } from './support/release-sign-in';
import { ORIGIN, startRuntime } from '../support/runtime';
import { auditStaffLighthouse } from './support/release-lighthouse';

type Actor = 'admin' | 'lead';

async function auditViewport(
  page: Page,
  paths: string[],
  options: { actor: Actor; width: number; output: string },
) {
  const { actor, width, output } = options;
  await page.setViewportSize({ width, height: 900 });
  const reports = [];
  for (const path of paths)
    reports.push({ actor, width, colorScheme: 'light', ...(await auditPage(page, path)) });
  await page.goto(`${ORIGIN}/people/`);
  await page.screenshot({ path: join(output, `${actor}-${width}.png`), fullPage: true });
  return reports;
}

const fixture = await startRuntime({ newsletter: true });
const output = join(fixture.root, 'test-results/staff-audit');
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'lighthouse'), { recursive: true });
const browser = await chromium
  .launch({
    args: [
      `--host-resolver-rules=MAP ${new URL(ORIGIN).hostname} 127.0.0.1:${fixture.port}, MAP * ~NOTFOUND`,
      '--no-proxy-server',
    ],
  })
  .catch(async (error: unknown) => {
    await fixture.dispose();
    throw error;
  });
try {
  const reports = [];
  for (const actor of ['admin', 'lead'] as const) {
    const context = await authenticatedContext(browser, fixture[actor]);
    try {
      const page = await context.newPage();
      const paths =
        actor === 'admin'
          ? [
              '/people/',
              `/people/${fixture.inside.id}/`,
              `/people/${fixture.inside.id}/edit/`,
              '/committees/',
              '/committees/events/',
              '/committees/events/settings/',
              '/review/',
              '/export/',
              '/access/',
              '/access/events/',
              '/newsletter/',
              '/offboarding/',
              '/imports/',
              '/paper/',
              '/paper/sheet/',
              '/welcome/',
              `/welcome/${fixture.welcomePerson.id}/`,
            ]
          : [
              '/people/',
              `/people/${fixture.inside.id}/`,
              '/committees/',
              '/committees/events/',
              '/paper/',
              '/paper/sheet/',
              '/welcome/',
              `/welcome/${fixture.welcomePerson.id}/`,
            ];
      for (const width of [390, 1440]) {
        reports.push(...(await auditViewport(page, paths, { actor, width, output })));
      }
      await page.emulateMedia({ colorScheme: 'dark' });
      reports.push({
        actor,
        width: 1440,
        colorScheme: 'dark',
        ...(await auditPage(page, '/people/')),
      });
      const refusedRoutes = actor === 'lead' ? ['/export/', '/access/events/'] : [];
      for (const path of refusedRoutes)
        assert.equal(
          (await page.goto(`${ORIGIN}${path}`))?.status(),
          403,
          'the audit must not widen committee-lead access',
        );
    } finally {
      await context.close();
    }
  }
  reports.push(...(await auditSignIn(browser, fixture)));
  assert.ok(
    reports
      .filter((report) => report.path === '/paper/')
      .every((report) => report.externalScripts > 0 && report.gzipBytes > 0),
    'the real compiled paper enhancement must be included in the route budget',
  );
  const native = await authenticatedContext(browser, fixture.admin, false);
  try {
    const page = await native.newPage();
    await page.goto(`${ORIGIN}/people/`);
    await page.keyboard.press('Tab');
    assert.equal(
      await page.locator(':focus').getAttribute('href'),
      '#main',
      'the first keyboard target must skip navigation',
    );
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'main');
    await page.getByLabel('Name or email').fill('Rider01234');
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get('q') === 'Rider01234'),
      page.getByLabel('Name or email').press('Enter'),
    ]);
    await page.getByRole('link', { name: 'Rider01234', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('q'), 'Rider01234');
  } finally {
    await native.close();
  }
  await writeFile(
    join(output, 'routes.json'),
    `${JSON.stringify({ runtime: 'compiled authenticated staff Worker; synthetic data only', noJavaScriptKeyboardSearch: 'passed', routes: reports }, null, 2)}\n`,
  );
  const lighthouse = await auditStaffLighthouse(fixture, join(output, 'lighthouse'));
  await writeFile(
    join(output, 'lighthouse-summary.json'),
    `${JSON.stringify(lighthouse, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      runtime: 'compiled authenticated staff Worker',
      auditedPages: reports.length,
      maxJavaScriptGzipBytes: Math.max(...reports.map((report) => report.gzipBytes)),
      noJavaScriptKeyboardSearch: 'passed',
      lighthouse,
      reports: output,
    }),
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
