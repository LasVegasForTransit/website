import assert from 'node:assert/strict';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page, type BrowserContext } from '@playwright/test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { ORIGIN, startRuntime } from '../support/runtime';
import {
  navigationFlow,
  navigationRuntime,
  navigationJourney,
  accessHeaders,
  faviconPreservesSetup,
  type Flow,
} from './support/auth-navigation';

const output = process.argv
  .find((arg) => arg.startsWith('--screenshots='))
  ?.slice('--screenshots='.length);
const captures: { mode: string; theme: string; width: number; step: string; file: string }[] = [];
const keys = await generateKeyPair('RS256');
const key = { ...(await exportJWK(keys.publicKey)), kid: 'google-auth-flow', alg: 'RS256' };
async function capture(
  page: Page,
  view: { mode: string; theme: string; width: number },
  step: string,
) {
  const { mode, theme, width } = view;
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    headings: document.querySelectorAll('h1').length,
    main: document.querySelectorAll('main').length,
    controls: [
      ...document.querySelectorAll(
        '.staff-gate-form input:not([type=hidden]),.staff-google-button,.staff-gate-panel .staff-action-link',
      ),
    ].map((el) => el.getBoundingClientRect().height),
  }));
  assert.equal(geometry.overflow, false, `${mode} ${step} ${width}`);
  assert.equal(geometry.headings, 1);
  assert.equal(geometry.main, 1);
  assert.ok(geometry.controls.every((height) => height >= 44));
  if (!output) return;
  const file = `${mode}-${theme}-${width}-${step}.png`;
  await page.screenshot({ path: join(output, file), fullPage: true });
  captures.push({ mode, theme, width, step, file });
}
async function memberJourney(
  page: Page,
  fixture: Pick<Awaited<ReturnType<typeof startRuntime>>, 'db'>,
  view: { mode: string; theme: string; width: number },
) {
  const { mode } = view;
  await page.getByRole('heading', { name: 'Connect these accounts?', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Member account email', { exact: true }).count(), 0);
  await capture(page, view, 'member-first-review');
  await page.getByRole('button', { name: 'Connect accounts', exact: true }).click();
  await page.getByRole('heading', { name: 'Welcome, Amina' }).waitFor();
  assert.equal(
    (await fixture.db.prepare('SELECT count(*) AS n FROM sign_in_codes').first<{ n: number }>())?.n,
    0,
  );
  console.log(`${mode}: signed-in member connected without email code.`);
  return;
}
async function createJourney(
  page: Page,
  fixture: Pick<Awaited<ReturnType<typeof startRuntime>>, 'db'>,
  view: { mode: string; theme: string; width: number },
) {
  const { mode } = view;
  await page.getByRole('link', { name: 'No, create one', exact: true }).click();
  await page.getByLabel('First name', { exact: true }).fill('Avery');
  await page.getByLabel('Last name (optional)', { exact: true }).fill('Rider');
  await capture(page, view, 'new-account-name');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('heading', { name: 'Welcome, Avery', exact: true }).waitFor();
  await page
    .getByText('Your account is ready. Continue to the tools for your LVBT work.', {
      exact: true,
    })
    .waitFor();
  await capture(page, view, 'new-account-ready');
  const person = await fixture.db
    .prepare("SELECT id,membership_status FROM people WHERE email='admin@lasvegasfortransit.org'")
    .first<{ id: string; membership_status: string }>();
  assert.ok(person);
  assert.equal(person.membership_status, 'not_member');
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT count(*) AS n FROM consent_records WHERE person_id=?')
        .bind(person.id)
        .first<{ n: number }>()
    )?.n,
    0,
  );
  await page.getByRole('link', { name: 'Continue', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/paper/`);
  await capture(page, view, 'new-account-paper');
  const denied = await page.goto(`${ORIGIN}/people/`);
  assert.equal(denied?.status(), 403);
  await page.goto(`${ORIGIN}/paper/`);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page
    .getByRole('heading', {
      name: 'Sign in to the Staff Portal',
    })
    .waitFor();
  console.log(`${mode}: new team account, no consent, paper-only permissions and sign-out passed.`);
  return;
}
function capturedCode(email: { to: string[]; text: string }) {
  assert.deepEqual(email.to, ['admin@example.invalid']);
  return /\b\d{6}\b/.exec(email.text)?.[0] ?? '';
}
async function seedMemberCookie(
  flow: string,
  fixture: Pick<Awaited<ReturnType<typeof startRuntime>>, 'db' | 'admin'>,
  context: BrowserContext,
) {
  if (flow !== 'member') return;
  {
    const member = await createSession(
      { PLATFORM_DB: fixture.db, LVBT_SIGN_IN_SECRET: 'local-browser-fixture-only' },
      fixture.admin.person.id,
      'member',
    );
    await context.addCookies([
      {
        name: '__Host-lvbt_session',
        value: member.token,
        url: ORIGIN,
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }
}
async function signOutAndReenter(page: Page, view: { mode: string; theme: string; width: number }) {
  const { mode } = view;
  await page.goto(`${ORIGIN}/people/`);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page
    .getByRole('heading', {
      name: 'Sign in to the Staff Portal',
    })
    .waitFor();
  await capture(page, view, '07-signed-out');
  await page.reload();
  assert.equal(
    new URL(page.url()).pathname,
    '/sign-in/',
    'SSO must not immediately recreate signed-out session',
  );
  if (mode === 'cloudflare-access')
    await page.getByRole('button', { name: 'Continue with LVBT account' }).click();
  else await page.getByRole('link', { name: 'Sign in with Google' }).click();
  await page.waitForURL(`${ORIGIN}/people/`);
  assert.equal(await page.getByRole('heading', { name: 'Finish setting up' }).count(), 0);
}
async function journey(
  mode: 'cloudflare-access' | 'google',
  theme: 'light' | 'dark',
  width: number,
  flow: Flow = 'existing',
) {
  let nonce = '';
  let code = '';
  const fixture = await startRuntime({
    initialAdminSetup: true,
    unlinkedAdmin: flow !== 'change',
    authMode: mode,
    emailCapture: (email) => {
      code = capturedCode(email);
    },
    ...(mode === 'google'
      ? {
          googleOAuth: {
            key,
            token: () =>
              new SignJWT({
                email: 'admin@lasvegasfortransit.org',
                email_verified: true,
                hd: 'lasvegasfortransit.org',
                nonce,
              })
                .setProtectedHeader({ alg: 'RS256', kid: key.kid })
                .setIssuer('https://accounts.google.com')
                .setAudience('google-runtime-fixture')
                .setSubject('fixture-google-admin')
                .setIssuedAt()
                .setExpirationTime('5m')
                .sign(keys.privateKey),
          },
        }
      : {}),
  });
  const navigation = await navigationRuntime(fixture, flow, mode, (authorization) => {
    nonce = authorization.searchParams.get('nonce') ?? '';
    const callback = new URL('/sign-in/google/callback', ORIGIN);
    callback.search = new URLSearchParams({
      state: authorization.searchParams.get('state') ?? '',
      code: 'local-fixture-only',
    }).toString();
    return callback.href;
  });
  const browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP * 127.0.0.1:${navigation.port}`, '--no-proxy-server'],
  });
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    colorScheme: theme,
    viewport: { width, height: 900 },
    ...accessHeaders(mode, fixture.admin.assertion),
  });
  await seedMemberCookie(flow, fixture, context);
  const page = await context.newPage();
  const cspErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy'))
      cspErrors.push(message.text());
  });
  try {
    await page.goto(`${ORIGIN}/sign-in/`);
    if (mode === 'google') {
      await page.getByRole('heading', { name: 'Sign in to the Staff Portal' }).waitFor();
      await capture(page, { mode, theme, width }, '01-sign-in');
      await page.getByRole('link', { name: 'Sign in with Google' }).click();
    }
    if (navigationFlow(flow)) {
      await navigationJourney(page, flow, cspErrors, mode);
      return;
    }
    if (flow === 'member') {
      await memberJourney(page, fixture, { mode, theme, width });
      return;
    }
    if (flow === 'create') {
      await createJourney(page, fixture, { mode, theme, width });
      return;
    }
    await page.getByRole('heading', { name: 'Finish setting up' }).waitFor();
    await capture(page, { mode, theme, width }, '02-membership-email');
    if (mode === 'cloudflare-access') {
      await context.clearCookies();
      await page.goto(`${ORIGIN}/sign-in/link-account/`);
      await page.getByRole('alert').waitFor();
      await capture(page, { mode, theme, width }, '02-membership-expired');
    }
    assert.equal(await page.getByText('LVBT Google account', { exact: false }).count(), 1);
    if (mode === 'google') {
      await fixture.db.prepare('DELETE FROM workspace_pending_links').run();
      await page.reload();
      await page.getByRole('alert').waitFor();
      await capture(page, { mode, theme, width }, '02-membership-expired');
      await page.getByRole('link', { name: 'Sign in with Google' }).click();
      await page.getByRole('heading', { name: 'Finish setting up' }).waitFor();
    }
    await page.getByRole('link', { name: 'Yes, sign in', exact: true }).click();
    await page.getByLabel('Member account email').fill('admin@example.invalid');
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    await faviconPreservesSetup(page);
    await capture(page, { mode, theme, width }, '03-membership-code');
    await page.getByLabel('6-digit code').fill('000000' === code ? '111111' : '000000');
    await page.getByRole('button', { name: 'Verify and connect accounts' }).click();
    await page.getByRole('alert').waitFor();
    await capture(page, { mode, theme, width }, '04-code-error');
    assert.match(code, /^\d{6}$/);
    await page.getByLabel('6-digit code').fill(code);
    await page.getByRole('button', { name: 'Verify and connect accounts' }).click();
    await page.getByRole('heading', { name: 'Welcome, Amina' }).waitFor();
    await capture(page, { mode, theme, width }, '05-ready');
    await page.getByRole('link', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Set up staff access' }).waitFor();
    await capture(page, { mode, theme, width }, '05-initial-admin');
    await page.getByRole('button', { name: 'Set up staff access' }).click();
    await page.waitForURL(`${ORIGIN}/people/`);
    await capture(page, { mode, theme, width }, '06-staff-home');
    const missing = await page.goto(`${ORIGIN}/missing-auth-fixture/`);
    assert.equal(missing?.status(), 404);
    await capture(page, { mode, theme, width }, '06-not-found');
    await signOutAndReenter(page, { mode, theme, width });
    const first = await fixture.db
      .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='staff_admin.bootstrap'")
      .first<{ n: number }>();
    assert.equal(first?.n, 1);
    await fixture.db.prepare('DROP TRIGGER staff_admin_keep_last').run();
    await fixture.db.prepare('DELETE FROM staff_administrators').run();
    const denied = await page.goto(`${ORIGIN}/people/`);
    assert.equal(denied?.status(), 403);
    await capture(page, { mode, theme, width }, '08-access-denied');
    const paper = await page.goto(`${ORIGIN}/paper/`);
    assert.equal(
      paper?.status(),
      200,
      'verified members retain paper-only access without an admin role',
    );
    await capture(page, { mode, theme, width }, '09-paper-only');
    await fixture.db.prepare('ALTER TABLE sessions RENAME TO unavailable_session_fixture').run();
    const unavailable = await page.goto(`${ORIGIN}/people/`);
    assert.equal(unavailable?.status(), 503);
    await capture(page, { mode, theme, width }, '10-unavailable');
    assert.equal(cspErrors.length, 0, cspErrors.join('\n'));
    console.log(
      `${mode} ${theme} ${width}: membership, wrong-code recovery, initial admin, sign-out, reentry, role removal and paper-only access passed.`,
    );
  } finally {
    await browser.close();
    await navigation.dispose();
    await fixture.dispose();
  }
}
if (output) await mkdir(output, { recursive: true });
for (const mode of ['cloudflare-access', 'google'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const width of output ? [390, 1440] : [390]) await journey(mode, theme, width);
for (const mode of ['cloudflare-access', 'google'] as const)
  for (const flow of ['create', 'member', 'handoff', 'change'] as const)
    await journey(mode, 'light', 390, flow);
if (output)
  await writeFile(
    join(output, 'captures.json'),
    JSON.stringify(
      {
        runtime: 'compiled Worker and migrated isolated database',
        providerTransport: 'stubbed locally',
        javaScript: false,
        captures,
      },
      null,
      2,
    ),
  );
