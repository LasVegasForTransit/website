import assert from 'node:assert/strict';
import type { Browser } from '@playwright/test';
import { ORIGIN, type startRuntime } from '../../support/runtime';
type Fixture = Awaited<ReturnType<typeof startRuntime>>;
export async function exercisePaperVolunteer(browser: Browser, fixture: Fixture) {
  const ended = await fixture.committees.endAssignment(
    fixture.leadAssignment.id,
    'stepped_back',
    fixture.admin.person.id,
    'paper-volunteer-fixture',
  );
  assert.equal(ended.kind, 'ok');
  const volunteerHeaders = {
    'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
    Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
  };
  for (const path of [
    '/people/',
    '/people/' + fixture.inside.id + '/',
    '/export/',
    '/welcome/',
    '/committees/',
    '/staff-admin/',
    '/paper/other/',
  ]) {
    const denied = await fixture.simulator.dispatchFetch(`${ORIGIN}${path}`, {
      headers: volunteerHeaders,
      redirect: 'manual',
    });
    assert.equal(denied.status, 403, `a paper volunteer cannot open ${path}`);
  }
  const landed = await fixture.simulator.dispatchFetch(
    `${ORIGIN}/sign-in/return/?next=%2Fpeople%2F`,
    { headers: volunteerHeaders, redirect: 'manual' },
  );
  assert.equal(landed.headers.get('Location'), '/paper/');
  const volunteer = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': fixture.lead.assertion },
    viewport: { width: 320, height: 900 },
  });
  await volunteer.addCookies([
    {
      name: '__Host-lvbt_session',
      value: fixture.lead.session.token,
      url: ORIGIN,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  const volunteerPage = await volunteer.newPage();
  await volunteerPage.goto(`${ORIGIN}/`);
  assert.equal(new URL(volunteerPage.url()).pathname, '/paper/');
  assert.equal(await volunteerPage.getByRole('link', { name: 'Members', exact: true }).count(), 0);
  assert.equal(
    await volunteerPage.getByRole('link', { name: 'Committees', exact: true }).count(),
    0,
  );
  assert.equal(
    await volunteerPage.getByRole('link', { name: '← Members', exact: true }).count(),
    0,
  );
  assert.equal(
    await volunteerPage.getByRole('button', { name: 'Sign out', exact: true }).count(),
    1,
  );
  await volunteerPage.getByRole('link', { name: 'Print blank signup sheet', exact: true }).click();
  assert.equal(new URL(volunteerPage.url()).pathname, '/paper/sheet/');
  await volunteerPage.getByRole('link', { name: '← Paper signups', exact: true }).click();
  await volunteerPage.getByLabel('Event or place on the sheet').fill('Volunteer native signup');
  await volunteerPage.getByLabel('Date on the sheet').fill('2026-10-01');
  await volunteerPage.getByLabel('Wording on the sheet').selectOption('paper-v1');
  const first = volunteerPage.getByRole('group', { name: 'Row 1', exact: true });
  await first.getByLabel('First name').fill('Volunteer entered');
  await first.getByLabel('Email', { exact: true }).fill('volunteer-paper@example.invalid');
  await first.getByLabel('Mailing-list signup').check();
  const batch = await volunteerPage.locator('input[name=batch_id]').inputValue();
  const [added] = await Promise.all([
    volunteerPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/paper/',
    ),
    volunteerPage.getByRole('button', { name: 'Add another person', exact: true }).click(),
  ]);
  assert.equal(added.status(), 200);
  assert.equal(await volunteerPage.locator('fieldset.staff-paper-row').count(), 10);
  assert.equal(
    await first.getByLabel('Email', { exact: true }).inputValue(),
    'volunteer-paper@example.invalid',
  );
  assert.equal(await first.getByLabel('Mailing-list signup').isChecked(), true);
  assert.equal(
    await fixture.db.prepare('SELECT 1 FROM paper_batches WHERE id=?').bind(batch).first(),
    null,
  );
  const [saved] = await Promise.all([
    volunteerPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/paper/',
    ),
    volunteerPage.getByRole('button', { name: 'Save sheet', exact: true }).click(),
  ]);
  assert.equal(saved.status(), 303);
  await volunteerPage.getByRole('status').filter({ hasText: 'Saved 1 entry.' }).waitFor();
  assert.ok(
    await fixture.db
      .prepare('SELECT 1 FROM paper_batches WHERE id=? AND actor_id=? AND applied_at IS NOT NULL')
      .bind(batch, fixture.lead.person.id)
      .first(),
  );
  const token = await volunteerPage.locator('form.staff-paper-form input[name=token]').inputValue();
  for (const path of ['/export/', `/welcome/${fixture.welcomePerson.id}/claim/`]) {
    const denied = await fixture.simulator.dispatchFetch(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { ...volunteerHeaders, Origin: ORIGIN },
      body: new URLSearchParams({ token }),
      redirect: 'manual',
    });
    assert.equal(denied.status, 403);
  }
  const [signedOut] = await Promise.all([
    volunteerPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/sign-out/',
    ),
    volunteerPage.getByRole('button', { name: 'Sign out', exact: true }).click(),
  ]);
  assert.equal(signedOut.status(), 303);
  await volunteerPage.waitForURL(`${ORIGIN}/sign-in/`);
  assert.equal(
    await fixture.db
      .prepare('SELECT 1 FROM sessions WHERE person_id=?')
      .bind(fixture.lead.person.id)
      .first(),
    null,
  );
  const revoked = await fixture.simulator.dispatchFetch(`${ORIGIN}/paper/`, {
    headers: volunteerHeaders,
    redirect: 'manual',
  });
  assert.equal(revoked.status, 303);
  await volunteer.close();
}
