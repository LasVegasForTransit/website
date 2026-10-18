import assert from 'node:assert/strict';
import { chromium, type Page } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { ORIGIN, startRuntime } from '../support/runtime';

async function confirmation(page: Page) {
  const values = await page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Delete member', exact: true }) })
    .evaluate((form) => Object.fromEntries(new FormData(form as HTMLFormElement)));
  return { ...values, action: 'delete' } as Record<string, string>;
}
async function deleteWithButton(page: Page) {
  const button = page.getByRole('button', { name: 'Delete member', exact: true });
  await button.focus();
  const [response] = await Promise.all([
    page.waitForResponse((reply) => reply.request().method() === 'POST'),
    page.keyboard.press('Enter'),
  ]);
  return response;
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
  await people.linkIdentity(fixture.inside.id, {
    platform: 'google_workspace',
    externalId: 'deletion-google',
    externalEmail: 'deletion-google@example.invalid',
    linkMethod: 'self_linked',
  });
  await people.linkIdentity(fixture.inside.id, {
    platform: 'beehiiv',
    externalId: 'deletion-newsletter',
    linkMethod: 'self_linked',
  });
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
  const url = `${ORIGIN}/people/${fixture.inside.id}/delete/`;
  const adminHeaders = {
    'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
    Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
    Origin: ORIGIN,
  };
  const post = (endpoint: string, form: Record<string, string>, headers = adminHeaders) =>
    fixture.simulator.dispatchFetch(endpoint, {
      method: 'POST',
      headers,
      body: new URLSearchParams(form),
      redirect: 'manual',
    });
  assert.equal((await page.goto(`${ORIGIN}/people/${fixture.inside.id}/edit/`))?.status(), 200);
  await page.getByRole('link', { name: 'Delete member', exact: true }).click();
  await page.getByRole('heading', { name: 'Delete member', exact: true }).waitFor();
  assert.ok((await page.locator('main').innerText()).includes('inside@example.invalid'));
  assert.equal(await page.getByText(t('staff.deletion.google'), { exact: true }).isVisible(), true);
  assert.equal(await page.getByText(t('staff.deletion.combined'), { exact: true }).count(), 0);
  assert.equal(await page.getByRole('textbox').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const bounds = await page
    .getByRole('button', { name: 'Delete member', exact: true })
    .boundingBox();
  assert.ok(bounds && bounds.height >= 44);
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/delete-member-mobile.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/people/${fixture.inside.id}/`);
  assert.equal((await people.getPerson(fixture.inside.id))?.email, 'inside@example.invalid');
  assert.equal(
    (await fixture.db.prepare('SELECT count(*) AS n FROM person_deletion_log').first())?.n,
    0,
  );
  await page.goto(`${ORIGIN}/people/${fixture.reviewPerson.id}/delete/`);
  assert.equal(await page.getByText(t('staff.deletion.google'), { exact: true }).count(), 0);

  await page.goto(url);
  const stale = await confirmation(page);
  await people.updateFields(fixture.inside.id, {
    source: 'staff',
    fields: { given_name: 'Updated Rider' },
  });
  assert.equal((await deleteWithButton(page)).status(), 409);
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Delete member', exact: true }).count(), 0);
  assert.equal((await people.getPerson(fixture.inside.id))?.given_name, 'Updated Rider');
  await page.getByRole('link', { name: 'Review deletion again', exact: true }).click();
  const form = await confirmation(page);
  const crossOrigin = await post(url, form, {
    ...adminHeaders,
    Origin: 'https://attacker.invalid',
  });
  assert.equal(crossOrigin.status, 403);
  await crossOrigin.text();
  const switched = await post(`${ORIGIN}/people/${fixture.reviewPerson.id}/delete/`, form);
  assert.equal(switched.status, 409);
  await switched.text();
  assert.equal((await deleteWithButton(page)).status(), 303);
  await page.waitForURL(`${ORIGIN}/people/?deleted=1`);
  await page
    .getByRole('status')
    .filter({ hasText: t('staff.people.deleted') })
    .waitFor();
  const receipt = await fixture.db
    .prepare('SELECT requested_by,operation_id FROM person_deletion_log WHERE person_id=?')
    .bind(fixture.inside.id)
    .first();
  assert.equal(receipt?.requested_by, fixture.admin.person.id);
  assert.equal(receipt.operation_id, form.operation_id);
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT count(*) AS n FROM consent_records WHERE person_id=?')
        .bind(fixture.inside.id)
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
        .bind(fixture.inside.id)
        .first()
    )?.n,
    1,
  );
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT state FROM newsletter_sync_jobs WHERE person_id=?')
        .bind(fixture.inside.id)
        .first()
    )?.state,
    'queued',
  );
  assert.equal(
    (await people.getPerson(fixture.reviewPerson.id))?.email,
    fixture.reviewPerson.email,
  );
  for (const replay of [form, stale]) {
    const response = await post(url, replay);
    assert.equal(response.status, 409);
    await response.text();
  }
  const deleted = await fixture.simulator.dispatchFetch(url, { headers: adminHeaders });
  assert.equal(deleted.status, 404);
  assert.equal((await deleted.text()).includes('inside@example.invalid'), false);
  const leadHeaders = {
    'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
    Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
    Origin: ORIGIN,
  };
  for (const method of ['GET', 'POST']) {
    const denied = await fixture.simulator.dispatchFetch(
      `${ORIGIN}/people/${fixture.reviewPerson.id}/delete/`,
      {
        method,
        headers: leadHeaders,
        ...(method === 'POST' ? { body: new URLSearchParams(form) } : {}),
      },
    );
    assert.equal(denied.status, 403);
    assert.equal((await denied.text()).includes(fixture.reviewPerson.email ?? ''), false);
  }
  await page.goto(`${ORIGIN}/people/${fixture.admin.person.id}/delete/`);
  assert.equal(await page.getByText(t('staff.deletion.self'), { exact: true }).isVisible(), true);
  assert.equal((await deleteWithButton(page)).status(), 409);
  await page
    .getByRole('alert')
    .filter({ hasText: /another current member administrator access/ })
    .waitFor();
  assert.ok(await people.getPerson(fixture.admin.person.id));
  await fixture.db
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .bind(fixture.lead.person.id, fixture.admin.person.id, new Date().toISOString())
    .run();
  await page.getByRole('link', { name: 'Review deletion again', exact: true }).click();
  assert.equal((await deleteWithButton(page)).status(), 303);
  await page.waitForURL(`${ORIGIN}/sign-in/?deleted=1`);
  await page
    .getByRole('status')
    .filter({ hasText: t('staff.deletion.selfDeleted') })
    .waitFor();
  assert.equal(
    (await context.cookies()).some((cookie) => cookie.name === '__Host-lvbt_session'),
    false,
  );
  console.log(
    JSON.stringify({
      runtime: 'compiled staff Worker',
      javaScript: false,
      checks: [
        'admin-only selected-member confirmation',
        'cancel and stale submissions preserve data',
        'same-origin scoped single-use token',
        'local erasure and durable cleanup receipts',
        'last-active-admin protection',
        'self deletion signs out with confirmation',
      ],
    }),
  );
  await context.close();
} finally {
  await browser.close();
  await fixture.dispose();
}
