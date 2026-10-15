import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { ORIGIN, startRuntime } from '../support/runtime';

const fixture = await startRuntime();
const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=MAP staff.lasvegasfortransit.org 127.0.0.1:${fixture.port}`,
    '--no-proxy-server',
  ],
});
try {
  const people = new PersonService(fixture.db);
  await people.linkIdentity(fixture.inside.id, {
    platform: 'google_workspace',
    externalId: 'workspace-review-fixture',
    externalEmail: 'erased-private@example.invalid',
    linkMethod: 'self_linked',
  });
  await people.deletePerson(fixture.inside.id);
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 320, height: 900 },
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
  assert.equal(
    (await page.goto(`${ORIGIN}/offboarding/`))?.status(),
    200,
    await page.locator('body').innerText(),
  );
  await page.getByRole('heading', { name: 'Google accounts to review', exact: true }).waitFor();
  const body = await page.locator('body').innerText();
  assert.ok(body.includes('workspace-review-fixture'));
  assert.equal(
    /erased-private@example.invalid|Committee Rider|inside@example.invalid/.test(body),
    false,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const button = page.getByRole('button', { name: 'Mark reviewed', exact: true });
  const bounds = await button.boundingBox();
  assert.ok(bounds && bounds.height >= 44);
  const [reply] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST'),
    button.click(),
  ]);
  assert.equal(reply.status(), 303);
  await page
    .getByRole('heading', { name: 'No Google accounts need review', exact: true })
    .waitFor();
  assert.equal(
    (
      await fixture.db
        .prepare(
          'SELECT count(*) AS n FROM workspace_offboarding_queue WHERE reviewed_at IS NOT NULL',
        )
        .first()
    )?.n,
    1,
  );
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT external_id FROM identities WHERE external_id='workspace-review-fixture'")
        .first()
    )?.external_id,
    'workspace-review-fixture',
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
  assert.equal((await page.goto(`${ORIGIN}/offboarding/`))?.status(), 403);
  console.log(
    JSON.stringify({
      runtime: 'compiled staff Worker',
      checks: [
        'administrator-only Google account review',
        'erased names and addresses absent',
        'review form works without JavaScript',
        'mobile layout and touch target',
        'review preserves provider account identifier',
      ],
    }),
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
