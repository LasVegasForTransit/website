import assert from 'node:assert/strict';
import type { Browser, Page } from '@playwright/test';
import { exerciseWelcomeHandoff } from './welcome-handoff';
import { ORIGIN, type startRuntime } from '../../support/runtime';
type Fixture = Awaited<ReturnType<typeof startRuntime>>;
async function welcomeBrowser(browser: Browser, fixture: Fixture, kind: 'admin' | 'lead') {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': fixture[kind].assertion },
    viewport: { width: 320, height: 900 },
    serviceWorkers: 'block',
  });
  await context.addCookies([
    {
      name: '__Host-lvbt_session',
      value: fixture[kind].session.token,
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
  return { context, page: await context.newPage() };
}
async function submitClaim(page: Page) {
  const [reply] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/claim/'),
    ),
    page.getByRole('button', { name: 'Assign to me', exact: true }).click(),
  ]);
  return reply;
}
async function releaseAndReclaim(page: Page, fixture: Fixture, path: string) {
  const [released] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/release/'),
    ),
    page.getByRole('button', { name: 'Unassign me', exact: true }).click(),
  ]);
  assert.equal(released.status(), 303);
  await page.waitForURL(`${ORIGIN}/welcome/`);
  assert.equal(
    await fixture.db
      .prepare('SELECT 1 FROM welcome_claims WHERE person_id=?')
      .bind(fixture.welcomePerson.id)
      .first(),
    null,
  );
  assert.equal(
    await fixture.db
      .prepare("SELECT 1 FROM engagement_events WHERE person_id=? AND type='welcomed'")
      .bind(fixture.welcomePerson.id)
      .first(),
    null,
  );
  await page.goto(path);
  assert.equal((await submitClaim(page)).status(), 303);
  await page.getByRole('heading', { name: 'Contact details' }).waitFor();
}
export async function exerciseWelcome(browser: Browser, fixture: Fixture) {
  const admin = await welcomeBrowser(browser, fixture, 'admin');
  const lead = await welcomeBrowser(browser, fixture, 'lead');
  try {
    const path = `${ORIGIN}/welcome/${fixture.welcomePerson.id}/`;
    await Promise.all([admin.page.goto(path), lead.page.goto(path)]);
    for (const page of [admin.page, lead.page]) {
      assert.equal((await page.content()).includes('welcome-fixture@example.invalid'), false);
      await page.getByRole('button', { name: 'Assign to me', exact: true }).waitFor();
    }
    assert.equal(await lead.page.getByRole('link', { name: 'View member profile' }).count(), 0);
    assert.equal(await admin.page.getByRole('link', { name: 'View member profile' }).count(), 1);
    const replies = await Promise.all([submitClaim(admin.page), submitClaim(lead.page)]);
    assert.deepEqual(replies.map((response) => response.status()).sort(), [303, 409]);
    const claimant = await fixture.db
      .prepare('SELECT actor_id FROM welcome_claims WHERE person_id=?')
      .bind(fixture.welcomePerson.id)
      .first<{ actor_id: string }>();
    assert.ok(claimant);
    const winner = claimant.actor_id === fixture.admin.person.id ? admin : lead;
    const loser = winner === admin ? lead : admin;
    await winner.page.getByRole('heading', { name: 'Contact details' }).waitFor();
    await loser.page.getByRole('link', { name: 'Back to welcome members', exact: true }).waitFor();
    assert.equal((await loser.page.content()).includes('welcome-fixture@example.invalid'), false);
    assert.equal(
      await loser.page.getByRole('link', { name: 'Back to welcome members', exact: true }).count(),
      1,
    );
    assert.equal(
      await winner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await releaseAndReclaim(winner.page, fixture, path);
    await winner.page.getByLabel('Contact method').selectOption('email');
    await winner.page
      .getByLabel('Notes (optional)', { exact: true })
      .fill('Sent a personal hello and asked which committee they want to join.');
    assert.equal(
      await winner.page
        .locator('form')
        .filter({ has: winner.page.getByRole('button', { name: 'Mark welcomed', exact: true }) })
        .evaluate((form) => (form as HTMLFormElement).checkValidity()),
      true,
    );
    await winner.page.screenshot({
      animations: 'disabled',
      path: `${fixture.root}/test-results/staff/welcome-mobile.png`,
      fullPage: true,
    });
    await winner.page.setViewportSize({ width: 1440, height: 1000 });
    await winner.page.screenshot({
      animations: 'disabled',
      path: `${fixture.root}/test-results/staff/welcome-desktop.png`,
      fullPage: true,
    });
    await winner.page.emulateMedia({ colorScheme: 'dark' });
    await winner.page.screenshot({
      animations: 'disabled',
      path: `${fixture.root}/test-results/staff/welcome-dark.png`,
      fullPage: true,
    });
    await winner.page.emulateMedia({ colorScheme: 'light' });
    await winner.page.setViewportSize({ width: 320, height: 900 });
    const [completed] = await Promise.all([
      winner.page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/complete/'),
      ),
      winner.page
        .getByRole('button', { name: 'Mark welcomed', exact: true })
        .click({ timeout: 5000 }),
    ]);
    assert.equal(completed.status(), 303, completed.status() === 303 ? '' : await completed.text());
    await winner.page.waitForURL(`${ORIGIN}/welcome/`);
    const events = await fixture.db
      .prepare("SELECT details FROM engagement_events WHERE person_id=? AND type='welcomed'")
      .bind(fixture.welcomePerson.id)
      .all<{ details: string }>();
    assert.equal(events.results.length, 1);
    const event = events.results[0];
    assert.ok(event);
    const details: unknown = JSON.parse(event.details);
    assert.deepEqual(details, {
      actorId: claimant.actor_id,
      method: 'email',
      note: 'Sent a personal hello and asked which committee they want to join.',
    });
    assert.equal((await winner.page.content()).includes('welcome-fixture@example.invalid'), false);
    assert.equal((await loser.page.goto(path))?.status(), 404);
    assert.equal((await loser.page.content()).includes('welcome-fixture@example.invalid'), false);
    await exerciseWelcomeHandoff(lead.page, fixture);
  } finally {
    await admin.context.close();
    await lead.context.close();
  }
}
