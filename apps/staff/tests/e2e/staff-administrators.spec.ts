import assert from 'node:assert/strict';
import { chromium, type Page } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { linkWorkspaceIdentity } from '@lasvegasfortransit/platform-storage/workspace-link';
import { createSession, readSession } from '@lasvegasfortransit/platform-storage/auth';
import { ORIGIN, startRuntime } from '../support/runtime';

type Action = 'grant' | 'revoke';
const actionLabel = (action: Action) =>
  action === 'grant' ? 'Make administrator' : 'Remove administrator';
const reviewUrl = (id: string, action: Action) =>
  `${ORIGIN}/administrators/${id}/?action=${action}`;

async function confirmation(page: Page, action: Action) {
  const button = page.getByRole('button', { name: actionLabel(action), exact: true });
  const values = await page
    .locator('form')
    .filter({ has: button })
    .evaluate((form) => Object.fromEntries(new FormData(form as HTMLFormElement)));
  assert.equal(await page.getByRole('checkbox').count(), 0);
  assert.equal(await page.getByRole('textbox').count(), 0);
  return { ...values, action } as Record<string, string>;
}

async function confirmWithKeyboard(page: Page, action: Action) {
  const button = page.getByRole('button', { name: actionLabel(action), exact: true });
  await button.focus();
  assert.equal(await button.evaluate((element) => element === document.activeElement), true);
  const bounds = await button.boundingBox();
  assert.ok(bounds && bounds.height >= 44);
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/administrator-${action}-keyboard.png`,
    fullPage: true,
    animations: 'disabled',
  });
  const [response] = await Promise.all([
    page.waitForResponse((reply) => reply.request().method() === 'POST'),
    page.keyboard.press('Enter'),
  ]);
  return response.status();
}

async function readableAtNarrowWidths(page: Page, screen: string) {
  for (const fontSize of ['100%', '200%']) {
    await page.evaluate((value) => {
      document.documentElement.style.fontSize = value;
    }, fontSize);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `320px layout must fit with ${fontSize} text`,
    );
    await page.screenshot({
      path: `${fixture.root}/test-results/staff/administrators-${screen}-${fontSize.replace('%', '')}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
}

const fixture = await startRuntime();
const browser = await chromium
  .launch({
    args: [
      `--host-resolver-rules=MAP staff.lasvegasfortransit.org 127.0.0.1:${fixture.port}, MAP * ~NOTFOUND`,
      '--no-proxy-server',
    ],
  })
  .catch(async (error: unknown) => {
    await fixture.dispose();
    throw error;
  });
try {
  const people = new PersonService(fixture.db);
  for (const [person, subject] of [
    [fixture.inside, 'administrator-candidate'],
    [fixture.welcomePerson, 'administrator-second-candidate'],
  ] as const) {
    const linked = await linkWorkspaceIdentity(fixture.db, {
      personId: person.id,
      workspace: {
        subject,
        email: `${subject}@lasvegasfortransit.org`,
        givenName: null,
        familyName: null,
      },
      method: 'self_linked',
      operationId: `link-${subject}`,
    });
    assert.equal(linked.kind, 'ok');
  }
  const headers = {
    'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
    Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
    Origin: ORIGIN,
  };
  const leadHeaders = {
    ...headers,
    'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
    Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
  };
  const post = (url: string, form: Record<string, string>, requestHeaders = headers) =>
    fixture.simulator.dispatchFetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: new URLSearchParams(form),
      redirect: 'manual',
    });
  const designation = (id: string) =>
    fixture.db
      .prepare('SELECT designated_by,designated_at FROM staff_administrators WHERE person_id=?')
      .bind(id)
      .first<{ designated_by: string; designated_at: string }>();
  async function audit(form: Record<string, string>, targetId: string, enabled: boolean) {
    const operation = await fixture.db
      .prepare(
        "SELECT actor_id,target_id,payload,applied_at FROM staff_operations WHERE operation_id=? AND kind='staff_admin.manage'",
      )
      .bind(form.operation_id)
      .first<{ actor_id: string; target_id: string; payload: string; applied_at: string }>();
    assert.ok(operation?.applied_at);
    assert.equal(operation.actor_id, fixture.admin.person.id);
    assert.equal(operation.target_id, targetId);
    const payload: unknown = JSON.parse(operation.payload);
    assert.ok(payload && typeof payload === 'object' && 'enabled' in payload);
    assert.equal(payload.enabled, enabled);
    assert.equal(
      (
        await fixture.db
          .prepare(
            "SELECT count(*) AS n FROM staff_audits WHERE operation_id=? AND actor_id=? AND target_id=? AND action='staff_admin.manage'",
          )
          .bind(form.operation_id, fixture.admin.person.id, targetId)
          .first<{ n: number }>()
      )?.n,
      1,
    );
  }
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 320, height: 900 },
    serviceWorkers: 'block',
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': fixture.admin.assertion },
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
  const target = fixture.inside.id;
  const grantUrl = reviewUrl(target, 'grant');
  const revokeUrl = reviewUrl(target, 'revoke');
  assert.equal((await page.goto(`${ORIGIN}/people/`))?.status(), 200);
  const menuLink = page.getByRole('link', { name: 'Staff administrators', exact: true });
  if (!(await menuLink.isVisible())) {
    await page.locator('details.staff-member-tasks > summary').focus();
    await page.keyboard.press('Enter');
  }
  await menuLink.click();
  await page.getByRole('heading', { name: 'Staff administrators', exact: true }).waitFor();
  assert.ok((await page.locator('main').innerText()).includes('admin@example.invalid'));
  await readableAtNarrowWidths(page, 'list');
  const search = page.getByRole('searchbox', { name: 'Name or email', exact: true });
  await search.fill('inside@example.invalid');
  await search.focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page
      .getByRole('button', { name: 'Search', exact: true })
      .evaluate((button) => button === document.activeElement),
    true,
  );
  await Promise.all([page.waitForURL(/\?q=/), page.keyboard.press('Enter')]);
  await page.getByRole('link', { name: /^Make administrator\b/ }).click();
  assert.equal(page.url(), grantUrl);
  await page
    .getByRole('heading', { name: 'Make Committee Rider an administrator?', exact: true })
    .waitFor();
  assert.ok((await page.locator('main').innerText()).includes('inside@example.invalid'));
  await readableAtNarrowWidths(page, 'grant');
  await page.getByRole('link', { name: 'Back to staff administrators', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/administrators/`);
  assert.equal(await designation(target), null);
  await page.goto(grantUrl);
  await confirmation(page, 'grant');
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/administrators/`);
  assert.equal(await designation(target), null);
  await page.goto(grantUrl);
  const grant = await confirmation(page, 'grant');
  for (const url of [`${ORIGIN}/administrators/`, grantUrl, revokeUrl]) {
    const denied = await fixture.simulator.dispatchFetch(url, { headers: leadHeaders });
    assert.equal(denied.status, 403);
    assert.equal((await denied.text()).includes('inside@example.invalid'), false);
  }
  const leadPost = await post(grantUrl, grant, leadHeaders);
  assert.equal(leadPost.status, 403);
  await leadPost.text();
  const crossOrigin = await post(grantUrl, grant, {
    ...headers,
    Origin: 'https://attacker.invalid',
  });
  assert.equal(crossOrigin.status, 403);
  await crossOrigin.text();
  const wrongTarget = await post(reviewUrl(fixture.welcomePerson.id, 'grant'), grant);
  assert.equal(wrongTarget.status, 409);
  await wrongTarget.text();
  const wrongAction = await post(revokeUrl, { ...grant, action: 'revoke' });
  assert.equal(wrongAction.status, 409);
  await wrongAction.text();
  assert.equal(await designation(target), null);
  assert.equal(await confirmWithKeyboard(page, 'grant'), 303);
  await page.waitForURL(`${ORIGIN}/administrators/?added=1`);
  assert.ok(await designation(target));
  await audit(grant, target, true);
  const replay = await post(grantUrl, grant);
  assert.equal(replay.status, 409);
  await replay.text();
  await audit(grant, target, true);

  await page.goto(revokeUrl);
  await confirmation(page, 'revoke');
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/administrators/`);
  assert.ok(await designation(target));
  await page.goto(revokeUrl);
  const revoke = await confirmation(page, 'revoke');
  assert.equal(await confirmWithKeyboard(page, 'revoke'), 303);
  await page.waitForURL(`${ORIGIN}/administrators/?removed=1`);
  assert.equal(await designation(target), null);
  await audit(revoke, target, false);
  const revokeReplay = await post(revokeUrl, revoke);
  assert.equal(revokeReplay.status, 409);
  await revokeReplay.text();

  await page.goto(grantUrl);
  const stalePerson = await confirmation(page, 'grant');
  await people.updateFields(target, { source: 'staff', fields: { given_name: 'Updated Rider' } });
  const staleReply = await post(grantUrl, stalePerson);
  assert.equal(staleReply.status, 409);
  await staleReply.text();
  assert.equal(await designation(target), null);
  await page.goto(grantUrl);
  const staleDesignation = await confirmation(page, 'grant');
  await fixture.db
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .bind(target, fixture.admin.person.id, '2026-01-01T00:00:00.000Z')
    .run();
  const changedDesignation = await post(grantUrl, staleDesignation);
  assert.equal(changedDesignation.status, 409);
  await changedDesignation.text();
  assert.equal((await designation(target))?.designated_at, '2026-01-01T00:00:00.000Z');
  await fixture.db.prepare('DELETE FROM staff_administrators WHERE person_id=?').bind(target).run();

  await fixture.db
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .bind(fixture.reviewPerson.id, fixture.admin.person.id, new Date().toISOString())
    .run();
  await people.withdrawConsent(fixture.reviewPerson.id, {
    scope: 'newsletter',
    source: 'fixture',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal(
    (await people.getExactPerson(fixture.reviewPerson.id))?.membership_status,
    'former_member',
  );
  await page.goto(reviewUrl(fixture.admin.person.id, 'revoke'));
  assert.equal(await confirmWithKeyboard(page, 'revoke'), 409);
  await page.getByRole('alert').waitFor();
  assert.ok(await designation(fixture.admin.person.id));
  assert.equal(
    await page.getByRole('button', { name: 'Remove administrator', exact: true }).count(),
    0,
  );

  await page.goto(grantUrl);
  const backup = await confirmation(page, 'grant');
  assert.equal(await confirmWithKeyboard(page, 'grant'), 303);
  await page.waitForURL(`${ORIGIN}/administrators/?added=1`);
  await audit(backup, target, true);
  await page.goto(reviewUrl(fixture.welcomePerson.id, 'grant'));
  const changedActorForm = await confirmation(page, 'grant');
  const originalAdmin = await designation(fixture.admin.person.id);
  assert.ok(originalAdmin);
  await fixture.db
    .prepare('DELETE FROM staff_administrators WHERE person_id=?')
    .bind(fixture.admin.person.id)
    .run();
  const changedActor = await post(reviewUrl(fixture.welcomePerson.id, 'grant'), changedActorForm);
  assert.equal(changedActor.status, 403);
  await changedActor.text();
  assert.equal(await designation(fixture.welcomePerson.id), null);
  await fixture.db
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .bind(fixture.admin.person.id, originalAdmin.designated_by, originalAdmin.designated_at)
    .run();

  const sessionEnv = {
    PLATFORM_DB: fixture.db,
    LVBT_SIGN_IN_SECRET: 'local-browser-fixture-only',
  };
  const otherMemberSession = await createSession(sessionEnv, fixture.admin.person.id, 'member');
  await page.goto(reviewUrl(fixture.admin.person.id, 'revoke'));
  const self = await confirmation(page, 'revoke');
  assert.equal(await confirmWithKeyboard(page, 'revoke'), 303);
  await page.waitForURL(`${ORIGIN}/sign-in/?administrator_removed=1`);
  assert.equal(await designation(fixture.admin.person.id), null);
  assert.ok(await designation(target));
  await audit(self, fixture.admin.person.id, false);
  assert.equal(
    (await context.cookies()).some((cookie) => cookie.name === '__Host-lvbt_session'),
    false,
  );
  assert.equal(await readSession(sessionEnv, fixture.admin.session.token), null);
  assert.equal((await readSession(sessionEnv, otherMemberSession.token))?.type, 'member');
  console.log(
    JSON.stringify({
      runtime: 'compiled staff Worker',
      javaScript: false,
      width: 320,
      enlargedText: '200%',
      checks: [
        'Members menu, eligible member search and keyboard confirmation',
        'single grant and revoke confirmations with cancellation and actor audits',
        'lead denial, same-origin target/action token scope and replay rejection',
        'stale member, designation and actor remain safe',
        'former administrator does not bypass final active administrator protection',
        'self revocation clears its session and cookies, preserving member sessions and a backup administrator',
      ],
    }),
  );
  await context.close();
} finally {
  await browser.close();
  await fixture.dispose();
}
