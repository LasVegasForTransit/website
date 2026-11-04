import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { recordAccessObservation } from '@lasvegasfortransit/platform-storage/access-observations';
import { markOperationFailed } from '@lasvegasfortransit/platform-storage/outbox';
import { ORIGIN, startRuntime } from '../support/runtime';

const fixture = await startRuntime({ discord: true });
const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=MAP staff.lasvegasfortransit.org 127.0.0.1:${fixture.port}`,
    '--no-proxy-server',
  ],
});
try {
  const person = fixture.welcomePerson;
  const identityId = '222222222222222222';
  await new PersonService(fixture.db).linkIdentity(person.id, {
    platform: 'discord',
    externalId: identityId,
    linkMethod: 'self_linked',
  });
  const old = new Date(Date.now() - 45 * 60_000);
  const observation = {
    personId: person.id,
    targetId: 'events',
    provider: 'discord' as const,
    identityId,
    identityEmail: null,
    resourceId: '123456789012345678',
    contextId: '111111111111111111',
    generation: 1,
    expectedAccess: true,
    state: 'granted' as const,
    observedAt: old.toISOString(),
    expiresAt: new Date(old.getTime() + 300_000).toISOString(),
  };
  const assigned = await fixture.committees.assign({
    personId: person.id,
    committeeId: 'events',
    role: 'member',
    actorId: fixture.admin.person.id,
    operationId: 'profile-events',
  });
  assert.equal(assigned.kind, 'ok');
  await fixture.db
    .prepare("UPDATE committees SET discord_role_id=? WHERE id='events'")
    .bind(observation.resourceId)
    .run();
  assert.equal(await recordAccessObservation(fixture.db, observation, old), true);
  await fixture.committees.assign({
    personId: person.id,
    committeeId: 'advocacy',
    role: 'member',
    actorId: fixture.admin.person.id,
    operationId: 'profile-unmapped',
  });
  await markOperationFailed(fixture.db, 'profile-unmapped', 'unknown');
  const context = await browser.newContext({
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
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
  await context.route('**/*', async (route) => {
    assert.equal(new URL(route.request().url()).origin, ORIGIN);
    await route.continue();
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/people/${person.id}/`);
  assert.equal(
    await page.locator('script').count(),
    0,
    'profile interactions must remain native HTML',
  );
  const accounts = page.getByRole('region', { name: 'Accounts', exact: true });
  assert.equal(
    await page
      .getByRole('region', { name: 'Committees', exact: true })
      .getByRole('link', {
        name: 'Google and Discord access needs attention',
        exact: true,
      })
      .count(),
    0,
    'an unmapped committee must not leave a false warning elsewhere on the profile',
  );
  await accounts.locator('summary').first().click();
  assert.equal(await accounts.getByText('Access last confirmed', { exact: true }).count(), 1);
  assert.equal(await accounts.getByText('Needs a fresh check', { exact: true }).count(), 0);
  assert.equal(await accounts.getByText('Google group', { exact: true }).count(), 0);
  assert.equal(
    await accounts.getByRole('heading', { name: 'Advocacy Team', exact: true }).count(),
    0,
  );
  assert.equal(await accounts.getByRole('button', { name: 'Try again', exact: true }).count(), 0);
  assert.deepEqual(
    await accounts
      .locator('.staff-profile-account-state')
      .first()
      .evaluate((element) => ({
        tag: element.tagName,
        border: getComputedStyle(element).borderWidth,
        background: getComputedStyle(element).backgroundColor,
      })),
    { tag: 'STRONG', border: '0px', background: 'rgba(0, 0, 0, 0)' },
    'account status is text, not an outlined control',
  );
  const shots = `${fixture.root}/test-results/staff/profile-access`;
  await mkdir(shots, { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await accounts.screenshot({ path: `${shots}/accounts-${width}.png`, animations: 'disabled' });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await accounts.screenshot({ path: `${shots}/accounts-dark.png`, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'light' });
  assert.deepEqual(
    (
      await new AxeBuilder({ page })
        .include('#accounts')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
    [],
  );
  const now = new Date();
  assert.equal(
    await recordAccessObservation(fixture.db, {
      ...observation,
      state: 'unknown',
      failure: 'permission_denied',
      observedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    }),
    true,
  );
  await markOperationFailed(fixture.db, 'profile-events', 'permission_denied');
  await page.reload();
  assert.equal(
    await page
      .getByRole('region', { name: 'Committees', exact: true })
      .getByRole('link', {
        name: 'Google and Discord access needs attention',
        exact: true,
      })
      .count(),
    1,
    'a configured failing committee must retain its link to recovery',
  );
  assert.equal(await accounts.getByText('Access last confirmed', { exact: true }).count(), 0);
  assert.equal(
    await accounts.getByText('Connection needs attention', { exact: true }).isVisible(),
    true,
  );
  await accounts.screenshot({ path: `${shots}/accounts-failure.png`, animations: 'disabled' });
  const [reply] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST'),
    accounts.getByRole('button', { name: 'Try again', exact: true }).click(),
  ]);
  assert.equal(reply.status(), 303);
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT state FROM integration_outbox WHERE id='profile-events'")
        .first<{ state: string }>()
    )?.state,
    'queued',
  );
  assert.equal(assigned.kind, 'ok');
  await fixture.committees.endAssignment(
    assigned.value.id,
    'stepped_back',
    fixture.admin.person.id,
    'profile-end',
  );
  const failedRemovalAt = new Date(Date.now() - 10 * 60_000);
  await fixture.db
    .prepare("DELETE FROM access_observations WHERE person_id=? AND target_id='events'")
    .bind(person.id)
    .run();
  assert.equal(
    await recordAccessObservation(
      fixture.db,
      {
        ...observation,
        generation: 2,
        expectedAccess: false,
        state: 'unknown',
        failure: 'provider_unavailable',
        observedAt: failedRemovalAt.toISOString(),
        expiresAt: new Date(failedRemovalAt.getTime() + 300_000).toISOString(),
      },
      failedRemovalAt,
    ),
    true,
  );
  await markOperationFailed(fixture.db, 'profile-end', 'provider_unavailable');
  await page.reload();
  assert.equal(
    await accounts.getByRole('heading', { name: 'Events Committee', exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await accounts.getByRole('button', { name: 'Try again', exact: true }).isVisible(),
    true,
  );
  await accounts.screenshot({
    path: `${shots}/accounts-removal-retry.png`,
    animations: 'disabled',
  });
  console.log(
    JSON.stringify({
      checks: [
        'last confirmation remains historical',
        'unmapped services do not expose retries',
        'configured failure retains native retry',
        'desktop, phone and dark renderings',
        'accounts axe accessibility',
      ],
      screenshots: shots,
    }),
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
