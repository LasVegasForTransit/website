import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { applyRosterImport } from '../../../site/platform/roster-import';
import { ORIGIN, startRuntime } from '../support/runtime';
import { authenticatedContext } from './support/release-page';

interface Identity {
  assertion: string;
  session: { token: string };
}
async function confirmationContext(browser: Browser, identity: Identity) {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': identity.assertion },
  });
  await context.addCookies([
    {
      name: '__Host-lvbt_session',
      value: identity.session.token,
      url: ORIGIN,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    assert.equal(url.origin, ORIGIN, 'confirmation stays in the synthetic local fixture');
    assert.ok(
      request.method() === 'GET' ||
        (request.method() === 'POST' && url.pathname === '/imports/resolve/'),
    );
    await route.continue();
  });
  return context;
}
async function fields(page: Page) {
  return page.locator('form[action="/imports/resolve/"] input').evaluateAll((inputs) =>
    Object.fromEntries(
      inputs.map((element) => {
        const input = element as HTMLInputElement;
        return [input.name, input.value];
      }),
    ),
  );
}
const fixture = await startRuntime();
const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=MAP ${new URL(ORIGIN).hostname} 127.0.0.1:${fixture.port}, MAP * ~NOTFOUND`,
    '--no-proxy-server',
  ],
});
const post = (identity: Identity, body: Record<string, string>, origin = ORIGIN) =>
  fixture.simulator.dispatchFetch(`${ORIGIN}/imports/resolve/`, {
    method: 'POST',
    headers: {
      'Cf-Access-Jwt-Assertion': identity.assertion,
      Cookie: `__Host-lvbt_session=${identity.session.token}`,
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  });
async function counts() {
  return fixture.db
    .prepare(
      `SELECT
    (SELECT count(*) FROM people) AS people,
    (SELECT count(*) FROM consent_records) AS consents,
    (SELECT count(*) FROM engagement_events) AS events,
    (SELECT count(*) FROM staff_audits WHERE action='roster.source.confirm') AS audits`,
    )
    .first();
}
try {
  const people = new PersonService(fixture.db);
  const { person } = await people.upsertFromSource({
    source: 'staff',
    fields: { email: 'held-roster@example.invalid', given_name: 'Existing', family_name: 'Rider' },
  });
  await applyRosterImport(
    fixture.db,
    [
      {
        source: 'notion_intake',
        sourceId: '00000000-0000-4000-8000-000000000000',
        email: 'held-roster@example.invalid',
        newsletter: {
          state: 'unknown',
          givenAt: null,
          wording: 'May we send you the newsletter?',
          answer: null,
        },
        form: {
          sourceSubmittedAt: 'Original minute from form',
          membershipAffirmative: null,
          fullName: 'Original form name',
          discordUsername: 'unlinked_form_name',
        },
      },
    ],
    { runId: 'compiled-fixture', now: new Date() },
  );
  const held = await fixture.db
    .prepare('SELECT id,person_id,suggested_person_id FROM roster_import_records')
    .first<{ id: string; person_id: string | null; suggested_person_id: string | null }>();
  assert.ok(held);
  assert.equal(held.person_id, null);
  assert.equal(held.suggested_person_id, person.id);
  const before = await counts();
  const context = await confirmationContext(browser, fixture.admin);
  const page = await context.newPage();
  // Axe injects asynchronous scripts; keep it separate from the native no-JS journey.
  const accessibility = await authenticatedContext(browser, fixture.admin, true);
  const accessibilityPage = await accessibility.newPage();
  const screenshots = '/tmp/lvbt-roster-native-review';
  await mkdir(screenshots, { recursive: true, mode: 0o700 });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto(`${ORIGIN}/imports/`);
    assert.equal(response?.status(), 200);
    assert.equal(response.headers()['cache-control'], 'private, no-store');
    assert.equal(
      await page.getByRole('heading', { name: 'Signups to check', exact: true }).count(),
      1,
    );
    assert.match(await page.locator('main').innerText(), /Original form name/);
    assert.match(await page.locator('main').innerText(), /Original minute from form/);
    assert.equal(await page.getByRole('link', { name: 'Existing Rider', exact: true }).count(), 1);
    assert.equal(
      await page.getByRole('button', { name: 'This is the same person', exact: true }).count(),
      1,
    );
    assert.equal((await page.locator('main').innerText()).includes('evidence_hash'), false);
    await writeFile(
      `${screenshots}/signup-review-${width}.png`,
      await page.screenshot({ fullPage: true }),
      { mode: 0o600 },
    );
    await accessibilityPage.setViewportSize({ width, height: 900 });
    assert.equal((await accessibilityPage.goto(`${ORIGIN}/imports/`))?.status(), 200);
    assert.equal(accessibilityPage.url(), `${ORIGIN}/imports/`);
    assert.equal(
      (await new AxeBuilder({ page: accessibilityPage }).analyze()).violations.length,
      0,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  }
  const lead = await confirmationContext(browser, fixture.lead);
  assert.equal((await (await lead.newPage()).goto(`${ORIGIN}/imports/`))?.status(), 403);
  const initial = await fields(page);
  assert.equal((await post(fixture.lead, initial)).status, 403);
  assert.equal((await post(fixture.admin, initial, 'https://outside.example.invalid')).status, 403);
  assert.equal((await page.goto(`${ORIGIN}/imports/resolve/`))?.status(), 405);
  const alterations: Array<Record<string, string>> = [
    { evidence_hash: 'x'.repeat(43) },
    { person_id: fixture.lead.person.id },
    { person_updated_at: '2020-01-01T00:00:00.000Z' },
  ];
  for (const alteration of alterations) {
    await page.goto(`${ORIGIN}/imports/`);
    assert.equal(
      (await post(fixture.admin, { ...(await fields(page)), ...alteration })).status,
      409,
    );
    assert.deepEqual(await counts(), before, 'forged or stale forms cannot change member data');
  }
  await page.goto(`${ORIGIN}/imports/`);
  const submitted = await fields(page);
  await page.getByRole('button', { name: 'This is the same person', exact: true }).focus();
  await Promise.all([
    page.waitForURL(`${ORIGIN}/imports/?confirmed=1`),
    page.keyboard.press('Enter'),
  ]);
  assert.equal(
    await page.getByRole('status').innerText(),
    'Signup matched. Its original answers have been saved.',
  );
  assert.equal(
    await page.getByRole('button', { name: 'This is the same person', exact: true }).count(),
    0,
  );
  assert.match(await page.locator('main').innerText(), /Ready to finish adding this signup/);
  assert.equal((await accessibilityPage.goto(`${ORIGIN}/imports/?confirmed=1`))?.status(), 200);
  assert.equal(accessibilityPage.url(), `${ORIGIN}/imports/?confirmed=1`);
  assert.equal((await new AxeBuilder({ page: accessibilityPage }).analyze()).violations.length, 0);
  assert.deepEqual(await counts(), { ...before, audits: 1 });
  assert.deepEqual(
    await fixture.db
      .prepare("SELECT person_id,link_method FROM identities WHERE platform='notion_intake'")
      .first(),
    { person_id: person.id, link_method: 'staff_confirmed' },
  );
  assert.deepEqual(
    await fixture.db
      .prepare('SELECT person_id,state FROM roster_import_records WHERE id=?')
      .bind(held.id)
      .first(),
    { person_id: person.id, state: 'held' },
  );
  const audit = await fixture.db
    .prepare(
      "SELECT actor_id,target_id,details FROM staff_audits WHERE action='roster.source.confirm'",
    )
    .first<{ actor_id: string; target_id: string; details: string }>();
  assert.ok(audit);
  assert.equal(audit.actor_id, fixture.admin.person.id);
  assert.equal(audit.target_id, person.id);
  assert.deepEqual(JSON.parse(audit.details), { recordId: held.id });
  assert.equal(
    (await post(fixture.admin, submitted)).status,
    409,
    'the native form token is single use',
  );
  assert.deepEqual(await counts(), { ...before, audits: 1 });
  await page.getByRole('link', { name: 'Correct their details' }).focus();
  await Promise.all([
    page.waitForURL(`${ORIGIN}/people/${person.id}/edit/`),
    page.keyboard.press('Enter'),
  ]);
  assert.equal(new URL(page.url()).pathname, `/people/${person.id}/edit/`);
  await people.withdrawConsent(fixture.admin.person.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: new Date().toISOString(),
  });
  const revokedCounts = await counts();
  const denied = await post(fixture.admin, submitted);
  assert.equal(denied.status, 403, 'a withdrawn session cannot replay its POST after signing in');
  assert.equal(denied.headers.has('Location'), false);
  await page.goto(`${ORIGIN}/imports/`);
  assert.equal(new URL(page.url()).pathname, '/sign-in/');
  assert.equal(
    await page.getByRole('heading', { name: 'Signups to check', exact: true }).count(),
    0,
  );
  assert.deepEqual(
    await counts(),
    revokedCounts,
    'revoked sessions cannot change source or member data',
  );
  await lead.close();
  await accessibility.close();
  await context.close();
  process.stdout.write(
    'Compiled signup review passed native no-JS confirmation, unchanged consent/history, audit persistence, phone/desktop accessibility and stale authority guards.\n',
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
