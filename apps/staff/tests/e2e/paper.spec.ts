import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
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
    assert.equal(new URL(route.request().url()).origin, ORIGIN);
    await route.continue();
  });
  const page = await context.newPage();
  const initial = await page.goto(`${ORIGIN}/paper/`);
  assert.equal(initial?.status(), 200);
  assert.equal(await page.locator('fieldset.staff-paper-row').count(), 5);
  await page.getByLabel('Event name on the sheet').fill('CityNerd test signup');
  await page.getByLabel('Date on the sheet').fill('2026-10-01');
  await page.getByLabel('Wording on the sheet').selectOption('paper-signup-v1');
  const first = page.getByRole('group', { name: 'Row 1', exact: true }),
    second = page.getByRole('group', { name: 'Row 2', exact: true });
  await first.getByLabel('First name').fill('Paper');
  await first.getByLabel('Last name').fill('Member');
  await first.getByLabel('Email', { exact: true }).fill('paper-member@example.invalid');
  await first.getByLabel('Mailing-list signup').check();
  await second.getByLabel('First name').fill('Event');
  await second.getByLabel('Last name').fill('Guest');
  await second.getByLabel('Email', { exact: true }).fill('bad-address');
  const batchId = await page.locator('input[name=batch_id]').inputValue();
  await page.getByRole('button', { name: 'Add row', exact: true }).click();
  assert.equal(await page.locator('fieldset.staff-paper-row').count(), 6);
  assert.equal(
    await first.getByLabel('Email', { exact: true }).inputValue(),
    'paper-member@example.invalid',
  );
  assert.equal(await first.getByLabel('Mailing-list signup').isChecked(), true);
  assert.equal(
    await page.getByLabel('Event name on the sheet').inputValue(),
    'CityNerd test signup',
  );
  assert.equal(await page.getByLabel('Wording on the sheet').inputValue(), 'paper-signup-v1');
  assert.equal(await page.locator('input[name=batch_id]').inputValue(), batchId);
  assert.equal(
    (await fixture.db.prepare('SELECT count(*) AS n FROM paper_batches').first())?.n,
    0,
    'adding a row must save no records',
  );
  const [invalid] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/paper/',
    ),
    page.getByRole('button', { name: 'Save sheet', exact: true }).click(),
  ]);
  assert.equal(invalid.status(), 400);
  assert.equal(await page.getByText('Enter a complete email address.', { exact: true }).count(), 1);
  assert.equal(
    await first.getByLabel('Email', { exact: true }).inputValue(),
    'paper-member@example.invalid',
  );
  assert.equal(await first.getByLabel('Mailing-list signup').isChecked(), true);
  assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM paper_batches').first())?.n, 0);
  await second.getByLabel('Email', { exact: true }).fill('paper-guest@example.invalid');
  const staleToken = await page.locator('form.staff-paper-form input[name=token]').inputValue();
  await page.getByRole('button', { name: 'Save sheet', exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get('saved') === batchId);
  assert.equal((await page.getByRole('status').textContent())?.trim(), 'Saved 2 entries.');
  const member = await fixture.db
    .prepare('SELECT id,membership_status FROM people WHERE email=?')
    .bind('paper-member@example.invalid')
    .first();
  assert.equal(member?.membership_status, 'member');
  const guest = await fixture.db
    .prepare('SELECT id,membership_status FROM people WHERE email=?')
    .bind('paper-guest@example.invalid')
    .first();
  assert.equal(guest?.membership_status, 'not_member');
  assert.equal(
    (
      await fixture.db
        .prepare(
          "SELECT count(*) AS n FROM engagement_events WHERE source='paper' AND type='attended'",
        )
        .first()
    )?.n,
    2,
  );
  const fields = new URLSearchParams({
    token: staleToken,
    batch_id: batchId,
    event_name: 'CityNerd test signup',
    event_date: '2026-10-01',
    wording_version: 'paper-signup-v1',
    row_count: '6',
    'rows.0.givenName': 'Paper',
    'rows.0.familyName': 'Member',
    'rows.0.email': 'paper-member@example.invalid',
    'rows.0.newsletterConsent': 'on',
    'rows.1.givenName': 'Event',
    'rows.1.familyName': 'Guest',
    'rows.1.email': 'paper-guest@example.invalid',
  });
  const expired = await fixture.simulator.dispatchFetch(`${ORIGIN}/paper/`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: fields.toString(),
  });
  assert.equal(expired.status, 409);
  assert.ok(
    (await expired.text()).includes('paper-member@example.invalid'),
    'expired forms must preserve entered rows',
  );
  fields.set('token', await page.locator('form.staff-paper-form input[name=token]').inputValue());
  const replay = await fixture.simulator.dispatchFetch(`${ORIGIN}/paper/`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: fields.toString(),
    redirect: 'manual',
  });
  assert.equal(replay.status, 303);
  assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM paper_batches').first())?.n, 1);
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='paper.import'")
        .first()
    )?.n,
    1,
  );
  const forged = await fixture.simulator.dispatchFetch(`${ORIGIN}/paper/`, {
    method: 'POST',
    headers: {
      ...headers,
      Origin: 'https://elsewhere.example.invalid',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: fields.toString(),
  });
  assert.equal(forged.status, 403);
  const lead = await fixture.simulator.dispatchFetch(`${ORIGIN}/paper/?saved=${batchId}`, {
    headers: {
      'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
      Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
    },
  });
  assert.equal(lead.status, 200);
  assert.equal(
    (await lead.text()).includes('Saved 2 entries.'),
    false,
    'another staff member must not read the batch receipt',
  );
  await fixture.db
    .prepare('UPDATE people SET email_verified_at=? WHERE id=?')
    .bind(new Date().toISOString(), fixture.inside.id)
    .run();
  const people = new PersonService(fixture.db);
  await people.withdrawConsent(fixture.inside.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2026-10-03T13:00:00.000Z',
  });
  await page.goto(`${ORIGIN}/paper/`);
  await page.getByLabel('Event name on the sheet').fill('Earlier paper signup');
  await page.getByLabel('Date on the sheet').fill('2026-10-03');
  await page.getByLabel('Wording on the sheet').selectOption('paper-signup-v1');
  await first.getByLabel('Email', { exact: true }).fill('inside@example.invalid');
  await first.getByLabel('Mailing-list signup').check();
  const heldBatch = await page.locator('input[name=batch_id]').inputValue();
  await page.getByRole('button', { name: 'Save sheet', exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get('saved') === heldBatch);
  assert.ok((await page.getByRole('status').textContent())?.includes('did not renew membership'));
  assert.equal((await people.getPerson(fixture.inside.id))?.membership_status, 'former_member');
  await page.goto(`${ORIGIN}/paper/`);
  await first.getByLabel('First name').focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await first.getByLabel('Last name').evaluate((el) => el === document.activeElement),
    true,
  );
  const screenshots = join(fixture.root, 'test-results/staff');
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, 'paper-entry-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 950 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({ path: join(screenshots, 'paper-entry-mobile.png'), fullPage: true });
  const sheet = await page.goto(`${ORIGIN}/paper/sheet/`);
  assert.equal(sheet?.status(), 200);
  assert.equal(await page.locator('tbody tr').count(), 12);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.pdf({
    path: join(screenshots, 'paper-signup-sheet.pdf'),
    format: 'Letter',
    preferCSSPageSize: true,
    printBackground: true,
  });
  await context.close();
  console.log(
    JSON.stringify({
      runtime: 'compiled HTTPS staff Worker',
      javaScript: false,
      checks: [
        'five initial paper rows',
        'native add-row preserves values and checked consent without writes',
        'row-specific validation preserves all entries',
        'explicit paper consent and attendance-only membership',
        'batch replay and expired-form preservation',
        'same-origin protection',
        'current lead receipt privacy',
        'recorded withdrawal preserves membership and explains held signup',
        'keyboard field order and 320px layout',
        'twelve-row US-letter PDF',
      ],
      artifact: join(screenshots, 'paper-signup-sheet.pdf'),
    }),
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
