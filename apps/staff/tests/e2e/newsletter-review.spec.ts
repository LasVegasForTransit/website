import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import {
  claimBeehiivPoll,
  saveBeehiivPollPage,
} from '@lasvegasfortransit/platform-storage/beehiiv-poll-store';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { ORIGIN, startRuntime } from '../support/runtime';

const fixture = await startRuntime({ newsletter: true });
const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=MAP staff.lasvegasfortransit.org 127.0.0.1:${fixture.port}`,
    '--no-proxy-server',
  ],
});
try {
  const now = new Date(),
    scan = await claimBeehiivPoll(fixture.db, 'pub_review', now);
  assert.ok(typeof scan !== 'string');
  await new PersonService(fixture.db).linkIdentity(fixture.inside.id, {
    platform: 'beehiiv',
    externalId: 'sub_review',
    externalEmail: fixture.inside.email ?? '',
    linkMethod: 'verified_email',
  });
  await saveBeehiivPollPage(fixture.db, scan, {
    rows: [
      { id: 'sub_review', status: 'inactive', created: Math.floor(now.getTime() / 1000) - 3600 },
      { id: 'sub_unknown', status: 'active', created: Math.floor(now.getTime() / 1000) - 3600 },
    ],
    nextCursor: null,
    now,
  });
  await fixture.db
    .prepare(
      "UPDATE newsletter_poll_choices SET state='needs_review',reason='choice_order_unknown' WHERE subscription_id='sub_review'",
    )
    .run();
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
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
  const page = await context.newPage();
  const response = await page.goto(`${ORIGIN}/newsletter/`);
  assert.equal(response?.status(), 200, await page.locator('body').innerText());
  await page.getByRole('link', { name: 'Review Committee Rider', exact: true }).click();
  await page.getByRole('heading', { name: 'Update the member record', exact: true }).waitFor();
  const body = await page.locator('body').innerText();
  assert.ok(body.includes('Mailing list') && body.includes('Member record'));
  assert.ok(!/pub_review|sub_review|poll|reconcil|Beehiiv|nonce|generation/.test(body));
  assert.equal(
    await page.getByRole('button', { name: 'Keep newer signup', exact: true }).count(),
    0,
  );
  await mkdir(join(fixture.root, 'test-results/staff'), { recursive: true });
  await page.screenshot({
    path: join(fixture.root, 'test-results/staff/newsletter-review-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const button = page.getByRole('button', { name: 'Use mailing list status', exact: true });
  const bounds = await button.boundingBox();
  assert.ok(bounds);
  assert.ok(bounds.height >= 44);
  await page.screenshot({
    path: join(fixture.root, 'test-results/staff/newsletter-review-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({
    path: join(fixture.root, 'test-results/staff/newsletter-review-dark.png'),
    fullPage: true,
    animations: 'disabled',
  });
  assert.equal(await page.getByRole('checkbox').count(), 0);
  assert.equal(await page.getByRole('textbox').count(), 0);
  const [reply] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/newsletter/'),
    ),
    button.click(),
  ]);
  assert.equal(reply.status(), 303);
  await page.getByRole('status').waitFor();
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT membership_status FROM people WHERE id=?')
        .bind(fixture.inside.id)
        .first<{ membership_status: string }>()
    )?.membership_status,
    'former_member',
  );
  await page.getByRole('link', { name: 'Review unmatched subscription', exact: true }).click();
  assert.ok((await page.locator('body').innerText()).includes('unknown-rider@example.invalid'));
  assert.equal(
    await page.getByRole('button', { name: 'Use mailing list status', exact: true }).count(),
    0,
  );
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
  assert.equal((await page.goto(`${ORIGIN}/newsletter/`))?.status(), 403);
  console.log(
    JSON.stringify({
      runtime: 'compiled staff and jobs Workers',
      checks: [
        'administrator-only newsletter follow-up',
        'confirmed choice without invented signup',
        'actual form submission without JavaScript',
        'unknown subscription address read privately',
        'mobile and dark-mode screenshots',
      ],
    }),
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
