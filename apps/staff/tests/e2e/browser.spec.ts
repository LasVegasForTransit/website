import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { ORIGIN, startRuntime } from '../support/runtime';
import { exerciseAccountAccess, exerciseLeadAccountAccess } from './support/account-access';
import { exerciseWelcome } from './support/welcome';
import { exerciseCorrections } from './support/corrections';
import { exerciseReviews } from './support/reviews';
import { exerciseMerges } from './support/merges';
import { exerciseCommittees, exerciseLeadCommittees } from './support/committees';
import { exerciseCommitteePages, exerciseLeadCommitteePages } from './support/committee-pages';
import { exerciseMemberSearch } from './support/member-search';
import { exerciseRosterUtility } from './support/roster-utility';
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
  const request = async (path: string, kind: 'admin' | 'lead' = 'admin') =>
    await fixture.simulator.dispatchFetch(`${ORIGIN}${path}`, {
      headers: {
        'Cf-Access-Jwt-Assertion': fixture[kind].assertion,
        Cookie: `__Host-lvbt_session=${fixture[kind].session.token}`,
      },
      redirect: 'manual',
    });
  const started = performance.now();
  const roster = await request('/people/?q=Rider01234&zip=89104');
  const html = await roster.text();
  const latencyMs = performance.now() - started;
  assert.equal(roster.status, 200, html);
  assert.ok(html.includes('rider01234@example.invalid'));
  assert.ok(latencyMs < 1000, `5000-person local Worker search took ${latencyMs.toFixed(1)} ms`);
  assert.equal(roster.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(roster.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(/<script\b/i.test(html), false);
  const unsigned = await fixture.simulator.dispatchFetch(`${ORIGIN}/fonts/public-sans-latin.woff2`);
  assert.equal(unsigned.status, 403);
  const font = await request('/fonts/public-sans-latin.woff2');
  assert.equal(font.status, 200);
  await font.arrayBuffer();
  assert.equal(font.headers.get('Cache-Control'), 'private, no-store');
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': fixture.admin.assertion },
    viewport: { width: 1440, height: 1000 },
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
    assert.equal(
      new URL(route.request().url()).origin,
      ORIGIN,
      'the fixture browser must make no external requests',
    );
    await route.continue();
  });
  const page = await context.newPage();
  await exerciseMemberSearch(page, fixture);
  await exerciseRosterUtility(page, fixture);
  await page.goto(`${ORIGIN}/people/`);
  await page.getByLabel('Name or email').fill('Rider01234');
  await page.locator('.staff-search-filters > summary').click();
  await page.getByLabel('ZIP code', { exact: true }).fill('89104');
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('q') === 'Rider01234'),
    page.getByRole('button', { name: 'Search' }).click(),
  ]);
  await page.waitForLoadState('load');
  assert.equal(await page.getByRole('link', { name: 'Rider01234', exact: true }).count(), 1);
  assert.equal(new URL(page.url()).searchParams.get('zip'), '89104');
  await page.getByRole('link', { name: 'Rider01234', exact: true }).click();
  await page.getByText('Record history', { exact: true }).click();
  await page.getByRole('heading', { name: 'Permission to contact' }).waitFor();
  assert.ok((await page.content()).includes('fixture-only'));
  const shots = join(fixture.root, 'test-results/staff');
  await mkdir(shots, { recursive: true });
  await exerciseCorrections(page, fixture);
  await exerciseCommittees(page, fixture);
  await exerciseCommitteePages(page, fixture);
  await exerciseAccountAccess(page, fixture);
  const screenshots = join(fixture.root, 'test-results/staff');
  await mkdir(screenshots, { recursive: true });
  await page.goto(`${ORIGIN}/people/`);
  await page.screenshot({ animations: 'disabled', path: join(screenshots, 'people-desktop.png') });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({ animations: 'disabled', path: join(screenshots, 'people-mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ animations: 'disabled', path: join(screenshots, 'people-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('link', { name: 'Next page', exact: true }).click();
  assert.ok(new URL(page.url()).searchParams.get('cursor'));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${ORIGIN}/people/${fixture.inside.id}/`);
  await page.screenshot({
    animations: 'disabled',
    path: join(screenshots, 'person-mobile.png'),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  assert.ok((await page.content()).includes('4321'));
  await exerciseWelcome(browser, fixture);
  await exerciseReviews(page, fixture);
  await exerciseMerges(page, fixture);
  await context.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': fixture.lead.assertion });
  await context.clearCookies();
  await context.addCookies([
    {
      name: '__Host-lvbt_session',
      value: fixture.lead.session.token,
      url: ORIGIN,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${ORIGIN}/people/`);
  assert.equal(await page.getByRole('link', { name: 'Committee Rider', exact: true }).count(), 1);
  assert.equal((await page.content()).includes('Rider01234'), false);
  await page.getByRole('link', { name: 'Committee Rider', exact: true }).click();
  assert.equal((await page.content()).includes('4321'), false);
  assert.equal(await page.getByRole('link', { name: 'Edit details', exact: true }).count(), 0);
  assert.equal((await request(`/people/${fixture.inside.id}/edit/`, 'lead')).status, 404);
  assert.equal((await request('/review/', 'lead')).status, 403);
  assert.equal(await page.getByRole('link', { name: 'Check duplicates', exact: true }).count(), 0);
  await exerciseLeadCommittees(page, fixture);
  await exerciseLeadCommitteePages(page);
  await exerciseLeadAccountAccess(page, fixture);
  await fixture.committees.endAssignment(
    fixture.leadAssignment.id,
    'stepped_back',
    fixture.admin.person.id,
    'revoke-lead',
  );
  const removed = await page.goto(`${ORIGIN}/people/`);
  assert.equal(removed?.status(), 403);
  assert.equal((await page.textContent('body'))?.trim(), "You don't have access to this");
  await context.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': fixture.admin.assertion });
  await context.clearCookies();
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
  await page.goto(`${ORIGIN}/people/${fixture.inside.id}/`);
  await page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Sign out', exact: true }) })
    .evaluate((form, actorId) => {
      const forged = document.createElement('input');
      forged.type = 'hidden';
      forged.name = 'actorId';
      forged.value = actorId;
      form.append(forged);
    }, fixture.lead.person.id);
  const [signedOut] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/sign-out/'),
    ),
    page.getByRole('button', { name: 'Sign out', exact: true }).click(),
  ]);
  assert.equal(signedOut.status(), 303);
  await page.waitForURL(`${ORIGIN}/sign-in/`);
  const after = await request('/people/');
  assert.equal(after.status, 303);
  assert.match(after.headers.get('Location') ?? '', /^\/sign-in\//);
  console.log(
    JSON.stringify({
      runtime: 'compiled staff Worker',
      javaScript: false,
      syntheticPeople: 5000,
      localSearchLatencyMs: Math.round(latencyMs),
      checks: [
        'admin roster filters and pagination',
        'member verification search finds former members and preserves current lead scope',
        'keyboard-only skip link and member search',
        'roster assignment returns to the same search and shows current welcome ownership',
        'consent profile',
        'native attributed correction and stale-form conflict',
        'administrator-only comparison and atomic keep-separate decision',
        'native combination and undo with current lead denial',
        'native committee assignment, role change, removal and cross-committee denial',
        'committee rosters, settings, stale editor conflict and lead settings denial',
        'private assets and headers',
        'lead scope and hidden donations',
        'immediate role revocation',
        'server sign-out ignores spoofed actor',
        'concurrent welcome claims and one attributed completion',
        'lead welcome interests and direct committee handoff',
        'truthful unconfigured access, native failed retry/removal and scoped lead history',
      ],
      screenshots,
    }),
  );
  await context.close();
} finally {
  await browser.close();
  await fixture.dispose();
}
