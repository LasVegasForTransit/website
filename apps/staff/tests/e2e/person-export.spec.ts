import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
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
  await new PersonService(fixture.db).recordEngagement(fixture.inside.id, {
    type: 'duplicate_reviewed',
    occurredAt: new Date().toISOString(),
    source: `private-source-${fixture.reviewPerson.id}`,
    reference: fixture.reviewPerson.id,
    details: {
      actorId: fixture.admin.person.id,
      email: fixture.reviewPerson.email,
      survivorId: fixture.reviewPerson.id,
    },
  });
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
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
  assert.equal((await page.goto(`${ORIGIN}/people/${fixture.inside.id}/`))?.status(), 200);
  const link = page.getByRole('link', { name: 'Download member record', exact: true });
  assert.equal(await link.getAttribute('href'), `/people/${fixture.inside.id}/data/`);
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const artifact = join(fixture.root, 'test-results/staff/member-record-fixture.json');
  await download.saveAs(artifact);
  assert.equal(await download.failure(), null);
  assert.match(download.suggestedFilename(), /^lvbt-member-data-\d{4}-\d{2}-\d{2}\.json$/);
  const text = await readFile(artifact, 'utf8');
  const data = JSON.parse(text) as {
    details: { id: string; email: string };
    committee_assignments: unknown[];
    consent_records: unknown[];
  };
  assert.equal(data.details.id, fixture.inside.id);
  assert.equal(data.details.email, fixture.inside.email);
  assert.equal(data.committee_assignments.length, 1);
  assert.equal(data.consent_records.length, 1);
  for (const forbidden of [
    fixture.reviewPerson.id,
    fixture.reviewPerson.email,
    fixture.admin.person.id,
    'private-source-',
    'actorId',
    'survivorId',
  ]) {
    assert.ok(forbidden);
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  const endpoint = `${ORIGIN}/people/${fixture.inside.id}/data/`;
  const adminHeaders = {
    'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
    Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
  };
  const direct = await fixture.simulator.dispatchFetch(endpoint, { headers: adminHeaders });
  assert.equal(direct.status, 200);
  assert.equal(direct.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(direct.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(direct.headers.get('X-Content-Type-Options'), 'nosniff');
  await direct.text();
  const lead = await fixture.simulator.dispatchFetch(endpoint, {
    headers: {
      'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
      Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
    },
  });
  assert.equal(lead.status, 403);
  assert.equal((await lead.text()).includes(fixture.inside.email ?? ''), false);
  await fixture.db
    .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
    .bind(fixture.admin.person.id)
    .run();
  const revoked = await fixture.simulator.dispatchFetch(endpoint, {
    headers: adminHeaders,
    redirect: 'manual',
  });
  assert.ok(revoked.status === 303 || revoked.status === 403);
  assert.equal((await revoked.text()).includes(fixture.inside.email ?? ''), false);
  await context.close();
  console.log(
    JSON.stringify({
      runtime: 'compiled HTTPS staff Worker',
      javaScript: false,
      checks: [
        'native member JSON download',
        'profile and committee evidence',
        'no other-person IDs or arbitrary activity details',
        'private no-store response',
        'committee lead denied',
        'current administrator membership required',
      ],
      artifact,
    }),
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
