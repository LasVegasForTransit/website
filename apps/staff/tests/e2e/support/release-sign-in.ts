import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { WorkspaceLinkService } from '@lasvegasfortransit/platform-storage/workspace-link';
import { SsoLinkService } from '@lasvegasfortransit/platform-storage/staff-sso';
import { readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { signedOutCookie, SIGNED_OUT_COOKIE } from '../../../src/lib/sso-navigation';
import { PENDING_COOKIE } from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { ORIGIN, startRuntime } from '../../support/runtime';
import { authenticatedContext, auditPage } from './release-page';

async function auditInitialAdmin(mode: 'cloudflare-access' | 'google') {
  const fixture = await startRuntime({ initialAdminSetup: true, authMode: mode });
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
      for (const path of ['/sign-in/ready/', '/sign-in/initial-admin/'])
        reports.push({
          actor: `${mode}:initial-administrator`,
          width,
          colorScheme: 'light',
          ...(await auditPage(page, path)),
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

async function auditAuthMode(mode: 'cloudflare-access' | 'google') {
  const fixture = await startRuntime({
    authMode: mode,
    unlinkedAdmin: true,
    initialAdminSetup: true,
  });
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
  const context = await authenticatedContext(browser, fixture.admin);
  const codeCount = () =>
    fixture.db.prepare('SELECT count(*) AS n FROM sign_in_codes').first<{ n: number }>();
  const before = await codeCount();
  try {
    await context.clearCookies();
    const env = {
      PLATFORM_DB: fixture.db,
      LVBT_SIGN_IN_SECRET: 'local-browser-fixture-only',
    };
    // A gateway-authenticated visitor only remains here after explicitly signing out.
    if (mode === 'cloudflare-access') {
      const marker = await signedOutCookie(env, fixture.admin.principal);
      const token = readCookie(
        new Request(ORIGIN, { headers: { Cookie: marker } }),
        SIGNED_OUT_COOKIE,
      );
      assert.ok(token);
      await context.addCookies([
        {
          name: SIGNED_OUT_COOKIE,
          value: token,
          url: ORIGIN,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ]);
    }
    const page = await context.newPage();
    const reports = [];
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      reports.push({
        actor: `${mode}:signed-out`,
        width,
        colorScheme: 'light',
        ...(await auditPage(page, '/sign-in/')),
      });
    }
    const pending =
      mode === 'cloudflare-access'
        ? await new SsoLinkService(env).begin(fixture.admin.principal, { returnTo: '/people/' })
        : await new WorkspaceLinkService(env).begin(
            {
              subject: 'fixture-google-admin',
              email: 'admin@lasvegasfortransit.org',
              givenName: null,
              familyName: null,
            },
            { returnTo: '/people/' },
          );
    await context.clearCookies();
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
      for (const path of [
        '/sign-in/link-account/',
        '/sign-in/link-account/?step=existing',
        '/sign-in/link-account/?step=new',
      ])
        reports.push({
          actor: `${mode}:unlinked-account`,
          width,
          colorScheme: 'light',
          ...(await auditPage(page, path)),
        });
    }
    assert.deepEqual(
      await codeCount(),
      before,
      'viewing sign-in pages must not request or send a code',
    );
    return reports;
  } finally {
    await context.close();
    await browser.close();
    await fixture.dispose();
  }
}

export async function auditSignIn() {
  return [
    ...(await auditAuthMode('cloudflare-access')),
    ...(await auditAuthMode('google')),
    ...(await auditInitialAdmin('cloudflare-access')),
    ...(await auditInitialAdmin('google')),
  ];
}
