import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import { SESSION_COOKIE, SIGNED_IN_COOKIE } from '@lasvegasfortransit/platform-core/web-auth';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { accountDataRuntime, ACCOUNT_ORIGIN } from '../runtime/support/account-data-runtime';
import { auditAccountData } from '../../scripts/audit/account-data';
import {
  axeBlockingViolations,
  semanticPageAudit,
  summarizeViolations,
} from '../support/a11y-helpers';

async function auditAccountPage(page: Page, heading: string) {
  await page.getByRole('heading', { name: heading, exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const main = document.querySelector('main');
    return main !== null && getComputedStyle(main).opacity === '1';
  });
  const violations = await axeBlockingViolations(page);
  assert.equal(violations.length, 0, summarizeViolations(violations));
  const semantics = await semanticPageAudit(page);
  assert.equal(semantics.mainCount, 1);
  assert.equal(semantics.h1Text.length, 1);
  assert.deepEqual(semantics.headingJumps, []);
  assert.equal(semantics.skipLinkHasTarget, true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}
async function tabToButton(page: Page, label: string) {
  const button = page.getByRole('button', { name: label, exact: true });
  for (let index = 0; index < 40; index++) {
    if (await button.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  assert.fail(`The keyboard could not reach ${label}`);
}

const fixture = await accountDataRuntime();
if (process.argv.includes('--lighthouse')) {
  try {
    await auditAccountData(fixture);
  } catch (error) {
    await fixture.dispose();
    throw error;
  }
}
const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=MAP ${new URL(ACCOUNT_ORIGIN).hostname} 127.0.0.1:${fixture.port}, MAP * ~NOTFOUND`,
    '--no-proxy-server',
  ],
});
try {
  for (const path of ['/account/data/', '/account/delete/', '/account/delete/code/']) {
    const signedOut = await fixture.simulator.dispatchFetch(`${ACCOUNT_ORIGIN}${path}`, {
      redirect: 'manual',
    });
    assert.equal(signedOut.status, 303);
    await signedOut.arrayBuffer();
  }
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 320, height: 900 },
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  const auditContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 320, height: 900 },
    serviceWorkers: 'block',
  });
  const cookiesForMember = [
    {
      name: SESSION_COOKIE,
      value: fixture.session.token,
      url: ACCOUNT_ORIGIN,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
    { name: SIGNED_IN_COOKIE, value: '1', url: ACCOUNT_ORIGIN, secure: true, sameSite: 'Lax' },
  ] as const;
  for (const current of [context, auditContext]) {
    await current.addCookies([...cookiesForMember]);
    await current.route('**/*', async (route) => {
      assert.equal(new URL(route.request().url()).origin, ACCOUNT_ORIGIN);
      await route.continue();
    });
  }
  const page = await context.newPage();
  const auditPage = await auditContext.newPage();
  const explanation = await page.goto(`${ACCOUNT_ORIGIN}/account/data/`);
  assert.equal(explanation?.status(), 200);
  assert.equal(explanation.headers()['cache-control'], 'private, no-store');
  await auditPage.goto(page.url());
  await auditAccountPage(auditPage, t('account.dataTitle'));
  await tabToButton(page, t('account.download'));
  const downloading = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const download = await downloading;
  assert.match(download.suggestedFilename(), /^lvbt-my-data-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();
  assert.ok(file);
  const exported = await readFile(file, 'utf8');
  assert.ok(exported.includes(fixture.person.email ?? ''));
  assert.equal(
    exported.includes(fixture.other.id) || exported.includes(fixture.other.email ?? ''),
    false,
  );
  const exportReceipt = await fixture.db
    .prepare(
      "SELECT actor_id,target_id,permission,details FROM staff_audits WHERE action='person.export' AND target_id=?",
    )
    .bind(fixture.person.id)
    .all<{ actor_id: string; target_id: string; permission: string | null; details: string }>();
  assert.equal(exportReceipt.results.length, 1, 'one successful member download has one receipt');
  assert.deepEqual(exportReceipt.results[0], {
    actor_id: fixture.person.id,
    target_id: fixture.person.id,
    permission: null,
    details: JSON.stringify({ requested_by: 'member' }),
  });
  await page.goto(`${ACCOUNT_ORIGIN}/account/delete/`);
  await auditPage.goto(page.url());
  await auditAccountPage(auditPage, t('account.deleteTitle'));
  assert.equal(fixture.emails.length, 0, 'opening the deletion explanation must not send a code');
  assert.equal(await page.locator('[data-slot="volunteer-note"]').isVisible(), true);
  await page.getByRole('link', { name: t('account.keep'), exact: true }).click();
  await page.waitForURL(`${ACCOUNT_ORIGIN}/account/`);
  assert.equal(fixture.emails.length, 0);
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT erased_at FROM people WHERE id=?')
        .bind(fixture.person.id)
        .first()
    )?.erased_at,
    null,
  );
  await page.goto(`${ACCOUNT_ORIGIN}/account/delete/`);
  await tabToButton(page, t('account.deleteSendCode'));
  await page.keyboard.press('Enter');
  await page.waitForURL(`${ACCOUNT_ORIGIN}/account/delete/code/`);
  await auditPage.goto(page.url());
  await auditAccountPage(auditPage, t('account.deleteTitle'));
  assert.equal(fixture.emails.length, 1, 'the explicit POST sends one fresh deletion code');
  const mail = fixture.emails[0];
  assert.ok(mail);
  assert.deepEqual(mail.to, [fixture.person.email]);
  assert.deepEqual(mail.tags, [{ name: 'template', value: 'delete_account' }]);
  const code = /^(\d{6})/.exec(mail.subject)?.[1];
  assert.ok(code);
  const field = page.getByLabel(t('signIn.codeLabel'), { exact: true });
  await field.fill(fixture.signInCode);
  const [wrong] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST'),
    field.press('Enter'),
  ]);
  assert.equal(wrong.status(), 400, 'a sign-in code cannot confirm account deletion');
  await page.locator('#code[aria-invalid="true"]').waitFor();
  assert.equal(await field.getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('[data-slot="error-summary"]').isVisible(), true);
  assert.equal(await page.locator('#code-error').isVisible(), true);
  assert.ok((await field.getAttribute('aria-describedby'))?.split(' ').includes('code-error'));
  await auditPage.goto(page.url());
  const auditCode = auditPage.getByLabel(t('signIn.codeLabel'), { exact: true });
  await auditCode.fill(fixture.signInCode);
  await Promise.all([
    auditPage.waitForResponse((response) => response.request().method() === 'POST'),
    auditCode.press('Enter'),
  ]);
  await auditAccountPage(auditPage, t('account.deleteTitle'));
  await field.fill(code);
  const [deleted] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST'),
    field.press('Enter'),
  ]);
  assert.equal(deleted.status(), 303);
  await page.waitForURL(`${ACCOUNT_ORIGIN}/account/deleted/`);
  await auditPage.goto(page.url());
  await auditAccountPage(auditPage, t('account.deleted'));
  const cookies = await context.cookies();
  assert.equal(
    cookies.some((cookie) => [SESSION_COOKIE, SIGNED_IN_COOKIE].includes(cookie.name)),
    false,
  );
  for (const session of [fixture.session, fixture.secondSession]) {
    const revoked = await fixture.simulator.dispatchFetch(`${ACCOUNT_ORIGIN}/account/data/`, {
      redirect: 'manual',
      headers: { Cookie: `${SESSION_COOKIE}=${session.token}` },
    });
    assert.equal(revoked.status, 303);
    await revoked.arrayBuffer();
  }
  const receipt = await fixture.db
    .prepare(
      'SELECT requested_by,requested_at,completed_at FROM person_deletion_log WHERE person_id=?',
    )
    .bind(fixture.person.id)
    .first();
  assert.equal(receipt?.requested_by, 'member');
  assert.ok(receipt.requested_at && receipt.completed_at);
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT count(*) AS n FROM consent_records WHERE person_id=?')
        .bind(fixture.person.id)
        .first()
    )?.n,
    0,
  );
  assert.equal(
    (
      await fixture.db
        .prepare(
          'SELECT count(*) AS n FROM workspace_offboarding_queue WHERE person_id=? AND reviewed_at IS NULL',
        )
        .bind(fixture.person.id)
        .first()
    )?.n,
    1,
  );
  assert.equal(fixture.emails.length, 1);
  console.log(
    JSON.stringify({
      runtime: 'compiled HTTPS website Worker',
      interactionJavaScript: false,
      auditJavaScript: true,
      checks: [
        'authenticated axe and semantic checks at 320px for data, deletion, code, error and deleted states',
        'keyboard JSON download excludes other member data and records its requester',
        'GET explanation and cancellation send no code',
        'explicit POST sends a dedicated deletion code',
        'sign-in code rejected and both sessions revoked',
        'deletion receipt and Workspace review without provider mutation',
      ],
    }),
  );
  await context.close();
  await auditContext.close();
} finally {
  await browser.close();
  await fixture.dispose();
}
