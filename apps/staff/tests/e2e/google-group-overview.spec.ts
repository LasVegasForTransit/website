import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { saveGoogleGroupSnapshot } from '@lasvegasfortransit/platform-storage/google-group-snapshots';
import { recordAccessObservation } from '@lasvegasfortransit/platform-storage/access-observations';
import { accessChangeWrite } from '@lasvegasfortransit/platform-storage/access-audit';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { linkWorkspaceIdentity } from '@lasvegasfortransit/platform-storage/workspace-link';
import { exerciseGoogleGroupActions } from './support/google-group-actions';
import { ORIGIN, startRuntime } from '../support/runtime';

const groupEmail = 'preview-events@lasvegasfortransit.org',
  consoleGroupEmail = 'console-users@lasvegasfortransit.org';
const fixture = await startRuntime({ googleGroups: true, discord: true });
const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=MAP staff.lasvegasfortransit.org 127.0.0.1:${fixture.port}`,
    '--no-proxy-server',
  ],
});
try {
  await fixture.db
    .prepare('UPDATE committees SET workspace_group_email=? WHERE id=?')
    .bind(groupEmail, 'events')
    .run();
  await fixture.committees.assign({
    personId: fixture.welcomePerson.id,
    committeeId: 'events',
    role: 'member',
    actorId: fixture.admin.person.id,
    operationId: 'group-review-welcome',
  });
  const { person: removalPerson } = await new PersonService(fixture.db).upsertFromSource({
    source: 'join_form',
    fields: { given_name: 'Alex', family_name: 'Volunteer', email: 'alex@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  assert.equal(
    (
      await linkWorkspaceIdentity(fixture.db, {
        personId: removalPerson.id,
        workspace: {
          subject: 'google-alex',
          email: 'alex@lasvegasfortransit.org',
          givenName: null,
          familyName: null,
        },
        method: 'self_linked',
        operationId: 'link-alex',
      })
    ).kind,
    'ok',
  );
  const now = new Date(),
    stamp = now.toISOString();
  for (const [email, members] of [
    [
      groupEmail,
      [
        { id: 'fixture-google-admin', type: 'USER', role: 'MEMBER' },
        { id: 'google-alex', type: 'USER', role: 'MEMBER' },
        { id: 'unknown-user', type: 'USER', role: 'MEMBER' },
      ],
    ],
    [
      consoleGroupEmail,
      Array.from({ length: 45 }, (_, index) => ({
        id: `staff-${index}`,
        type: 'USER',
        role: 'MEMBER',
      })),
    ],
  ] as const)
    assert.equal(
      await saveGoogleGroupSnapshot(
        fixture.db,
        {
          customerId: 'Cfixture',
          groupEmail: email,
          groupId: email === groupEmail ? 'events-id' : 'staff-id',
          members,
          startedAt: stamp,
          observedAt: stamp,
        },
        { consoleGroupEmail, now, isCurrent: () => Promise.resolve(true) },
      ),
      true,
    );
  const role = '222222222222222222',
    identity = '444444444444444444';
  await fixture.db
    .prepare("UPDATE committees SET discord_role_id=? WHERE id='events'")
    .bind(role)
    .run();
  await new PersonService(fixture.db).linkIdentity(fixture.welcomePerson.id, {
    platform: 'discord',
    externalId: identity,
    linkMethod: 'self_linked',
  });
  const generation = await fixture.db
    .prepare(
      "SELECT generation FROM reconcile_generations WHERE person_id=? AND target_id='events'",
    )
    .bind(fixture.welcomePerson.id)
    .first<{ generation: number }>();
  assert.equal(
    await recordAccessObservation(
      fixture.db,
      {
        personId: fixture.welcomePerson.id,
        targetId: 'events',
        provider: 'discord',
        identityId: identity,
        identityEmail: null,
        resourceId: role,
        contextId: '111111111111111111',
        generation: generation?.generation ?? 0,
        expectedAccess: true,
        state: 'absent',
        observedAt: stamp,
        expiresAt: new Date(now.getTime() + 300000).toISOString(),
      },
      now,
    ),
    true,
    JSON.stringify(
      await fixture.db
        .prepare(
          "SELECT (SELECT count(*) FROM access_observations) AS stored,(SELECT count(*) FROM identities WHERE person_id=? AND platform='discord') AS identities",
        )
        .bind(fixture.welcomePerson.id)
        .first(),
    ),
  );
  await accessChangeWrite(
    fixture.db,
    {
      change: {
        personId: fixture.welcomePerson.id,
        system: 'discord',
        action: 'grant',
        target: role,
        actor: fixture.admin.person.id,
        reason: 'staff_correction',
        operationId: 'compiled-access-change',
        changed: true,
      },
    },
    now,
  ).run();
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': fixture.admin.assertion },
    viewport: { width: 1440, height: 1000 },
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
  await context.route('**/*', async (route) => {
    assert.equal(new URL(route.request().url()).origin, ORIGIN);
    await route.continue();
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/access/`);
  assert.equal(
    await page.getByRole('heading', { name: 'Google groups', exact: true }).count(),
    1,
    'staff need a readable group overview',
  );
  assert.equal(await page.getByText('45 people in this group', { exact: true }).isVisible(), true);
  assert.equal(
    await page
      .getByText('Review who needs staff access before adding more people.', { exact: true })
      .isVisible(),
    true,
  );
  const group = page.getByRole('link', { name: 'Events Committee', exact: true });
  await Promise.all([page.waitForURL(`${ORIGIN}/access/events/`), group.click()]);
  assert.equal(
    await page.getByRole('heading', { name: 'Events Committee', exact: true }).count(),
    1,
  );
  assert.equal(await page.getByText('Expected access', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText('Confirmed access', { exact: true }).isVisible(), true);
  assert.equal((await page.getByText(/^First noticed /).count()) > 0, true);
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  }
  await Promise.all([
    page.waitForURL(`${ORIGIN}/access/groups/?group=${encodeURIComponent(groupEmail)}`),
    page.getByRole('link', { name: 'Review Google access', exact: true }).click(),
  ]);

  assert.equal(await page.getByText('Amina Staff', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText('Not on this committee', { exact: true }).count(), 2);
  assert.equal(await page.getByText('Leon Staff', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText('Missing Google access', { exact: true }).isVisible(), true);
  assert.equal((await page.content()).includes('unknown-user'), false);
  assert.equal(
    await page.getByText('1 account needs to be matched to a member.', { exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Restore Google access', exact: true }).count(),
    1,
    'missing access needs a direct correction',
  );
  const shots = `${fixture.root}/test-results/staff`;
  await mkdir(shots, { recursive: true });
  for (const [name, width] of [
    ['desktop', 1440],
    ['tablet', 768],
    ['mobile', 320],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({
      path: `${shots}/google-group-${name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({
    path: `${shots}/google-group-dark.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto(`${ORIGIN}/access/`);
  assert.equal(
    await page
      .getByRole('heading', { name: 'Discord corrections in the last seven days', exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .locator('.staff-discord-corrections')
      .getByText('Corrected by staff', { exact: true })
      .isVisible(),
    true,
  );
  assert.equal(
    await page
      .locator('.staff-discord-corrections')
      .getByText('By Amina Staff', { exact: true })
      .isVisible(),
    true,
  );
  await page.screenshot({
    path: `${shots}/google-group-overview-mobile.png`,
    fullPage: true,
    animations: 'disabled',
  });
  const groupLink = page.getByRole('link', { name: 'Events Committee', exact: true });
  for (let tab = 0; tab < 25; tab++) {
    if (await groupLink.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  assert.equal(await groupLink.evaluate((element) => element.matches(':focus-visible')), true);
  await page.keyboard.press('Enter');
  await page.waitForURL(`${ORIGIN}/access/events/`);
  await Promise.all([
    page.waitForURL(`${ORIGIN}/access/groups/?group=${encodeURIComponent(groupEmail)}`),
    page.getByRole('link', { name: 'Review Google access', exact: true }).click(),
  ]);
  await exerciseGoogleGroupActions(page, fixture, removalPerson.id);
  const denied = await fixture.simulator.dispatchFetch(
    `${ORIGIN}/access/groups/?group=${groupEmail}`,
    {
      headers: {
        'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
        Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
      },
    },
  );
  assert.equal(denied.status, 403);
  const combinedDenied = await fixture.simulator.dispatchFetch(`${ORIGIN}/access/events/`, {
    headers: {
      'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
      Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
    },
  });
  assert.equal(combinedDenied.status, 403);
  assert.equal((await combinedDenied.text()).includes('Expected access'), false);
  assert.equal((await denied.text()).includes('Amina Staff'), false);
  await fixture.db
    .prepare(
      "INSERT INTO google_group_check_failures(context_id,group_email,failure,started_at) VALUES('Cfixture',?,'provider_unavailable',?)",
    )
    .bind(groupEmail, new Date(Date.now() + 1).toISOString())
    .run();
  await page.reload();
  assert.equal(
    await page
      .getByText('Google couldn’t be checked. Try again later.', { exact: true })
      .isVisible(),
    true,
  );
  assert.equal(await page.getByText('Amina Staff', { exact: true }).count(), 0);
  await fixture.db.prepare('DELETE FROM google_group_check_failures').run();
  await fixture.db
    .prepare('UPDATE google_group_inventory SET expires_at=? WHERE group_email=?')
    .bind(new Date(Date.now() - 1).toISOString(), groupEmail)
    .run();
  await page.reload();
  assert.equal(
    await page
      .getByText('A fresh Google check is needed before reviewing access.', { exact: true })
      .isVisible(),
    true,
  );
  assert.equal(await page.getByText('Amina Staff', { exact: true }).count(), 0);
  const invalid = await fixture.simulator.dispatchFetch(`${ORIGIN}/access/?group_cursor=invalid!`, {
    headers: {
      'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
      Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
    },
  });
  assert.equal(invalid.status, 400);
  console.log(
    'Google group overview: compiled native pages, authorization, failure, keyboard and adaptive screenshots passed.',
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
