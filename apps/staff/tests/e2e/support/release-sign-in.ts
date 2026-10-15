import assert from 'node:assert/strict';
import { chromium, type Browser } from '@playwright/test';
import { WorkspaceLinkService } from '@lasvegasfortransit/platform-storage/workspace-link';
import { PENDING_COOKIE } from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { ORIGIN, startRuntime } from '../../support/runtime';
import { authenticatedContext, auditPage } from './release-page';

async function auditInitialAdmin() {
  const fixture = await startRuntime({ initialAdminSetup: true });
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
    const context = await authenticatedContext(browser, fixture.admin);
    const page = await context.newPage();
    const reports = [];
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      reports.push({
        actor: 'initial-administrator',
        width,
        colorScheme: 'light',
        ...(await auditPage(page, '/sign-in/initial-admin/')),
      });
    }
    assert.equal(
      (
        await fixture.db
          .prepare('SELECT count(*) AS n FROM staff_administrators')
          .first<{ n: number }>()
      )?.n,
      0,
      'auditing setup must not grant administrator access',
    );
    return reports;
  } finally {
    await browser.close();
    await fixture.dispose();
  }
}

export async function auditSignIn(
  browser: Browser,
  fixture: Awaited<ReturnType<typeof startRuntime>>,
) {
  const context = await authenticatedContext(browser, fixture.admin);
  const codeCount = () =>
    fixture.db.prepare('SELECT count(*) AS n FROM sign_in_codes').first<{ n: number }>();
  const before = await codeCount();
  try {
    // Access authenticates the Workspace account; there is deliberately no website session.
    await context.clearCookies();
    const page = await context.newPage();
    const reports = [];
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      reports.push({
        actor: 'signed-out',
        width,
        colorScheme: 'light',
        ...(await auditPage(page, '/sign-in/')),
      });
    }
    const pending = await new WorkspaceLinkService({
      PLATFORM_DB: fixture.db,
      LVBT_SIGN_IN_SECRET: 'local-browser-fixture-only',
    }).begin(
      {
        subject: 'fixture-google-admin',
        email: 'admin@lasvegasfortransit.org',
        givenName: null,
        familyName: null,
      },
      { returnTo: '/people/' },
    );
    await context.addCookies([
      {
        name: PENDING_COOKIE,
        value: pending,
        url: ORIGIN,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      reports.push({
        actor: 'pending-membership-confirmation',
        width,
        colorScheme: 'light',
        ...(await auditPage(page, '/sign-in/link-account/')),
      });
    }
    assert.deepEqual(
      await codeCount(),
      before,
      'viewing sign-in pages must not request or send a code',
    );
    return [...reports, ...(await auditInitialAdmin())];
  } finally {
    await context.close();
  }
}
