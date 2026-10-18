import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
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
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
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
  assert.equal((await page.goto(`${ORIGIN}/roles/`))?.status(), 200);
  await page.getByLabel('Role name', { exact: true }).fill('Welcome coordinator');
  const createForm = page.locator('form[action="/roles/"]');
  const createBody = new URLSearchParams({
    token: await createForm.locator('input[name="token"]').inputValue(),
    operation_id: await createForm.locator('input[name="operation_id"]').inputValue(),
    name: 'Welcome coordinator',
  });
  const adminHeaders = {
    'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
    Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
    Origin: ORIGIN,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const crossOrigin = await fixture.simulator.dispatchFetch(`${ORIGIN}/roles/`, {
    method: 'POST',
    headers: { ...adminHeaders, Origin: 'https://outside.example.invalid' },
    body: createBody.toString(),
  });
  assert.equal(crossOrigin.status, 403);
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  await page.getByRole('heading', { name: 'Roles', exact: true }).waitFor();
  assert.equal(
    await page
      .locator('.staff-role-list > li > strong')
      .filter({ hasText: 'Welcome coordinator' })
      .count(),
    1,
  );
  const replay = await fixture.simulator.dispatchFetch(`${ORIGIN}/roles/`, {
    method: 'POST',
    headers: adminHeaders,
    body: createBody.toString(),
    redirect: 'manual',
  });
  assert.equal(replay.status, 409, 'A consumed native form cannot create another role');
  await page.getByRole('link', { name: 'Rename Welcome coordinator', exact: true }).click();
  await page.getByLabel('Role name', { exact: true }).fill('Member welcome coordinator');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page
    .getByRole('link', { name: 'Rename Member welcome coordinator', exact: true })
    .waitFor();
  await page.getByLabel('Role name', { exact: true }).fill('Treasurer');
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  await page.goto(`${ORIGIN}/people/${fixture.inside.id}/`);
  const roles = page.getByRole('region', { name: 'Roles', exact: true });
  await roles
    .getByLabel('Choose a role', { exact: true })
    .selectOption({ label: 'Member welcome coordinator' });
  await roles.getByRole('button', { name: 'Add role', exact: true }).click();
  await roles
    .locator('.staff-role-list strong')
    .filter({ hasText: 'Member welcome coordinator' })
    .waitFor();
  await roles.getByLabel('Choose a role', { exact: true }).selectOption({ label: 'Treasurer' });
  await roles.getByRole('button', { name: 'Add role', exact: true }).click();
  await roles.locator('.staff-role-list strong').filter({ hasText: 'Treasurer' }).waitFor();
  assert.equal(
    await roles.locator('.staff-role-list > li').count(),
    2,
    'A member can have several independent roles',
  );
  assert.equal(
    (await page.getByText('Events Committee', { exact: true }).count()) > 0,
    true,
    'Role assignment preserves committee membership',
  );
  await page.goto(`${ORIGIN}/roles/`);
  await page
    .getByRole('link', { name: 'Stop using Member welcome coordinator', exact: true })
    .click();
  await page.getByRole('button', { name: 'Stop using this role', exact: true }).click();
  await page.goto(`${ORIGIN}/people/${fixture.inside.id}/`);
  await roles
    .locator('.staff-role-list strong')
    .filter({ hasText: 'Member welcome coordinator' })
    .waitFor();
  await roles.getByText('No longer offered', { exact: true }).waitFor();
  assert.equal(
    await roles.locator('select option').filter({ hasText: 'Member welcome coordinator' }).count(),
    0,
  );
  await roles
    .getByRole('button', { name: 'Remove Member welcome coordinator', exact: true })
    .click();
  await roles.locator('.staff-role-list strong').filter({ hasText: 'Treasurer' }).waitFor();
  assert.equal(
    await roles.locator('.staff-role-list > li').count(),
    1,
    'Removing one role preserves the other',
  );
  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await roles.getByText(/^Since /).count(), 0);
  const removeBounds = await roles
    .getByRole('button', { name: 'Remove Treasurer', exact: true })
    .boundingBox();
  assert.ok(
    removeBounds && removeBounds.height >= 44,
    'Compact removal keeps an accessible touch target',
  );
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/person-roles-mobile.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await roles.getByRole('button', { name: 'Remove Treasurer', exact: true }).click();
  await roles.getByText('No roles assigned.', { exact: true }).waitFor();
  await page.goto(`${ORIGIN}/roles/`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/organization-roles-mobile.png`,
    fullPage: true,
    animations: 'disabled',
  });
  const denied = await fixture.simulator.dispatchFetch(`${ORIGIN}/roles/`, {
    headers: {
      'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
      Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
    },
  });
  assert.equal(denied.status, 403);
  const deniedWrite = await fixture.simulator.dispatchFetch(
    `${ORIGIN}/people/${fixture.inside.id}/`,
    {
      method: 'POST',
      headers: {
        ...adminHeaders,
        'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
        Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
      },
      body: new URLSearchParams({
        action: 'organization_role',
        role_action: 'assign',
        role_id: 'forged',
        operation_id: 'lead-forged',
        token: 'a'.repeat(43),
      }).toString(),
    },
  );
  assert.equal(
    deniedWrite.status,
    403,
    'Committee leadership does not grant role assignment authority',
  );
  console.log(
    'Native role creation, rename, independent person assignment, retirement, removal and current authority passed.',
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
