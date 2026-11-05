import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { enrollWorkspaceAccount } from '@lasvegasfortransit/platform-storage/workspace-enrollment';
import { createSsoSession } from '@lasvegasfortransit/platform-storage/staff-sso';
import { chooseWorkspaceAccount } from '@lasvegasfortransit/platform-storage/staff-discord-handoff';
import { createSession, readSession } from '@lasvegasfortransit/platform-storage/auth';
import { startRuntime } from '../support/runtime';
import { onboardingDiscord } from '../support/onboarding-runtime';
const STAFF = 'https://staff-preview.lasvegasfortransit.org',
  MEMBER = 'https://preview.lasvegasfortransit.org';
const fixture = await startRuntime({ onboarding: true });
const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=MAP staff-preview.lasvegasfortransit.org 127.0.0.1:${fixture.port}, MAP preview.lasvegasfortransit.org 127.0.0.1:${fixture.port}, MAP discord.com 127.0.0.1:${fixture.port}, MAP * ~NOTFOUND`,
    '--no-proxy-server',
  ],
});
const shots =
  process.env.LVBT_ONBOARDING_SCREENSHOTS ??
  join(fixture.root, 'test-results/workspace-onboarding');
try {
  await mkdir(shots, { recursive: true });
  if (!process.argv.includes('--connect-only')) {
    await substitutedBrowser(browser);
    await teamDiscord(browser);
  }
  await connectMember(browser);
  console.log(
    JSON.stringify({
      checks: [
        'compiled staff/public workers with shared D1 and independent secrets',
        'Access SSO team onboarding',
        'native Discord handoff and CSP chain',
        'cancellation and screening return',
        'empty provisional connection with both account proofs',
        'phone/desktop light/dark and axe',
      ],
      screenshots: shots,
    }),
  );
} finally {
  await browser.close();
  await fixture.dispose();
}

async function enrolled(suffix: string) {
  const now = new Date(),
    email = `onboarding-${suffix}@lasvegasfortransit.org`,
    subject = `onboarding-access-${suffix}`;
  const result = await enrollWorkspaceAccount(
    fixture.db,
    {
      customerId: 'C-lvbt',
      userId: `onboarding-google-${suffix}`,
      email,
      givenName: 'Avery',
      familyName: 'Volunteer',
      orgUnitId: 'ou-human',
      suspended: false,
      archived: false,
      deleted: false,
      observedAt: now.toISOString(),
    },
    {
      environment: 'production',
      customerId: 'C-lvbt',
      humanOrgUnitIds: ['ou-human'],
      includedUserIds: [],
      excludedUserIds: [],
      previewUserIds: [],
    },
    now,
  );
  assert.ok(result.personId);
  const session = await createSsoSession(
    { PLATFORM_DB: fixture.db, LVBT_SIGN_IN_SECRET: 'local-browser-fixture-only' },
    {
      email,
      subject,
      issuer: 'https://lvbt.cloudflareaccess.com',
      expiresAt: new Date(now.getTime() + 3600000),
    },
  );
  assert.ok(session);
  return {
    personId: result.personId,
    session,
    assertion: await fixture.assertionFor(email, subject),
  };
}
async function contextFor(browser: Browser, team: Awaited<ReturnType<typeof enrolled>>) {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': team.assertion },
  });
  await context.addCookies([
    {
      name: '__Host-lvbt_session',
      value: team.session.token,
      url: STAFF,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  return context;
}
async function substitutedBrowser(browser: Browser) {
  const team = await enrolled('attack'),
    owner = await contextFor(browser, team);
  const attacker = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: true });
  try {
    await chooseWorkspaceAccount(
      { PLATFORM_DB: fixture.db, LVBT_SIGN_IN_SECRET: 'local-browser-fixture-only' },
      team.session.token,
    );
    const page = await owner.newPage();
    const started = await fixture.simulator.dispatchFetch(`${STAFF}/onboarding/discord/`, {
      method: 'POST',
      headers: {
        Origin: STAFF,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cf-Access-Jwt-Assertion': team.assertion,
        Cookie: `__Host-lvbt_session=${team.session.token}`,
      },
      body: 'action=start',
      redirect: 'manual',
    });
    assert.equal(started.status, 303);
    const ticket = /__Host-lvbt_staff_discord=([\w-]{43})/.exec(
      started.headers.get('Set-Cookie') ?? '',
    )?.[1];
    assert.ok(ticket, 'the actual returned redirect carries its handoff cookie');
    await owner.addCookies([
      {
        name: '__Host-lvbt_staff_discord',
        value: ticket,
        url: STAFF,
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const raw = started.headers.get('Location');
    assert.ok(raw);
    const attackPage = await attacker.newPage();
    await attackPage.route('https://staff-preview.lasvegasfortransit.org/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<h1>Attacker browser has no staff session</h1>',
      }),
    );
    const binding = attackPage.waitForResponse((r) => r.url() === raw);
    await attackPage.goto(raw);
    const bound = await binding;
    assert.equal(bound.status(), 303);
    const substituted = bound.headers().location;
    assert.ok(substituted);
    await page.goto(substituted);
    const result = await attackPage.goto(raw + '&finish=1');
    assert.ok(result);
    assert.equal(
      result.status(),
      410,
      'the initial ticket and attacker cookie cannot consume the owner approval',
    );
    assert.equal(
      (
        await fixture.db
          .prepare('SELECT public_session_hash FROM staff_discord_handoffs WHERE person_id=?')
          .bind(team.personId)
          .first()
      )?.public_session_hash,
      null,
    );
  } finally {
    await owner.close();
    await attacker.close();
  }
}
async function render(page: Page, name: string, assertion: string) {
  for (const [width, height, colorScheme] of [
    [1280, 900, 'light'],
    [390, 844, 'light'],
    [1280, 900, 'dark'],
    [320, 568, 'dark'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: join(shots, `${name}-${width}-${colorScheme}.png`),
      fullPage: true,
    });
  }
  const auditContext = await browser.newContext({
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    storageState: await page.context().storageState(),
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': assertion },
  });
  try {
    const auditPage = await auditContext.newPage();
    await auditPage.goto(page.url());
    const result = await new AxeBuilder({ page: auditPage }).analyze();
    assert.deepEqual(result.violations, []);
  } finally {
    await auditContext.close();
  }
}
async function teamDiscord(browser: Browser) {
  onboardingDiscord.reset();
  const team = await enrolled('discord'),
    context = await contextFor(browser, team);
  try {
    const page = await context.newPage();
    await page.goto(`${STAFF}/paper/`);
    await page.waitForURL((url) => url.pathname === '/onboarding/account/');
    await render(page, 'account-choice', team.assertion);
    await page.getByRole('button', { name: 'Use Workspace account', exact: true }).click();
    await page.getByRole('heading', { name: 'Join the team on Discord', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /skip|later/i }).count(), 0);
    await render(page, 'discord-connect', team.assertion);
    await page.getByRole('button', { name: 'Connect Discord', exact: true }).click();
    await page
      .getByRole('heading', { name: 'Fixture Discord authorization', exact: true })
      .waitFor();
    await page.getByRole('link', { name: 'Cancel authorization' }).click();
    await page.waitForURL((url) => url.origin === STAFF && url.pathname === '/onboarding/discord/');
    await page.getByRole('button', { name: 'Connect Discord', exact: true }).click();
    await page.getByRole('link', { name: 'Authorize fixture account' }).click();
    await page.waitForURL(
      (url) => url.origin === STAFF && url.pathname === '/onboarding/discord/screening/',
    );
    await page.getByRole('heading', { name: 'Accept the server rules', exact: true }).waitFor();
    await render(page, 'discord-screening', team.assertion);
    await page.getByRole('button', { name: 'Check again', exact: true }).click();
    await page.getByRole('heading', { name: 'Accept the server rules', exact: true }).waitFor();
    onboardingDiscord.acceptRules();
    await page.getByRole('button', { name: 'Check again', exact: true }).click();
    await page.getByRole('heading', { name: 'Your account is ready', exact: true }).waitFor();
    await render(page, 'onboarding-ready', team.assertion);
    await page.getByRole('link', { name: 'Open portal', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/paper/');
    assert.equal(
      (
        await fixture.db
          .prepare('SELECT membership_status FROM people WHERE id=?')
          .bind(team.personId)
          .first()
      )?.membership_status,
      'not_member',
    );
    assert.equal(
      (
        await fixture.db
          .prepare('SELECT count(*) AS n FROM consent_records WHERE person_id=?')
          .bind(team.personId)
          .first()
      )?.n,
      0,
    );
    assert.equal(
      (
        await fixture.db
          .prepare('SELECT count(*) AS n FROM committee_assignments WHERE person_id=?')
          .bind(team.personId)
          .first()
      )?.n,
      0,
    );
  } finally {
    await context.close();
  }
}
async function connectMember(browser: Browser) {
  const team = await enrolled('connect'),
    context = await contextFor(browser, team);
  try {
    const member = await createSession(
      { PLATFORM_DB: fixture.db, LVBT_SIGN_IN_SECRET: 'onboarding-public-secret' },
      fixture.inside.id,
      'member',
    );
    await context.addCookies([
      {
        name: '__Host-lvbt_session',
        value: member.token,
        url: MEMBER,
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    await page.goto(`${STAFF}/onboarding/account/?next=/paper/`);
    await page.getByRole('button', { name: 'Connect account', exact: true }).click();
    await page
      .getByRole('heading', { name: 'Connect your existing LVBT account', exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Switch account', exact: true }).count(),
      1,
    );
    const proofUrl = page.url();
    await page.getByRole('button', { name: 'Switch account', exact: true }).click();
    await page.waitForURL((url) => url.origin === MEMBER && url.pathname === '/sign-in/');
    assert.ok(
      !(await context.cookies(MEMBER)).some((cookie) => cookie.name === '__Host-lvbt_session'),
    );
    assert.equal(
      await readSession(
        { PLATFORM_DB: fixture.db, LVBT_SIGN_IN_SECRET: 'onboarding-public-secret' },
        member.token,
      ),
      null,
    );
    const chosen = await createSession(
      { PLATFORM_DB: fixture.db, LVBT_SIGN_IN_SECRET: 'onboarding-public-secret' },
      fixture.welcomePerson.id,
      'member',
    );
    await context.addCookies([
      {
        name: '__Host-lvbt_session',
        value: chosen.token,
        url: MEMBER,
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto(proofUrl);
    await page
      .getByRole('heading', { name: 'Connect your existing LVBT account', exact: true })
      .waitFor();
    await render(page, 'member-proof', team.assertion);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Connect these accounts?', exact: true }).waitFor();
    await render(page, 'accounts-confirm', team.assertion);
    await page.getByRole('button', { name: 'Connect accounts', exact: true }).click();
    assert.equal(
      (
        await fixture.db
          .prepare(
            "SELECT person_id FROM identities WHERE external_id='onboarding-google-connect' AND platform='google_workspace'",
          )
          .first()
      )?.person_id,
      fixture.welcomePerson.id,
    );
    assert.ok(
      (
        await fixture.db
          .prepare('SELECT deleted_at FROM people WHERE id=?')
          .bind(team.personId)
          .first()
      )?.deleted_at,
    );
    // Access signs in again with the rebound principal after revoking the old session.
    await page.getByRole('heading', { name: 'Join the team on Discord', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('next'), '/paper/');
    const replacement = (await context.cookies(STAFF)).find(
      (c) => c.name === '__Host-lvbt_session',
    );
    assert.ok(replacement);
    assert.notEqual(replacement.value, team.session.token);
    const staffAuth = {
      PLATFORM_DB: fixture.db,
      LVBT_SIGN_IN_SECRET: 'local-browser-fixture-only',
    };
    assert.equal(await readSession(staffAuth, team.session.token), null);
    assert.equal(
      (await readSession(staffAuth, replacement.value))?.personId,
      fixture.welcomePerson.id,
    );
  } finally {
    await context.close();
  }
}
