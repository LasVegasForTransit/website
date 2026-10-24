import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import {
  saveTaskCheckinSource,
  upsertNotionTaskSnapshot,
  setTaskCheckinConsent,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { confirmTaskCheckinMapping } from '@lasvegasfortransit/platform-storage/notion-task-admin';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { taskPolicy } from '@lasvegasfortransit/platform-integrations/test-task-policy';
import { ORIGIN, startRuntime } from '../support/runtime';
const fixture = await startRuntime(),
  sourceId = '10000000-0000-4000-8000-000000000001';
const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=MAP staff.lasvegasfortransit.org 127.0.0.1:${fixture.port}`,
    '--no-proxy-server',
  ],
});
try {
  const now = new Date(),
    service = new PersonService(fixture.db);
  const wrong = (
    await service.upsertFromSource({
      source: 'staff',
      fields: { email: 'wrong-alex@example.invalid', given_name: 'Alex', family_name: 'Volunteer' },
    })
  ).person;
  const right = (
    await service.upsertFromSource({
      source: 'staff',
      fields: {
        email: 'uninterruptedaccountreferenceforcorrectalexatmobilewidth@example.invalid',
        given_name: 'Alex',
        family_name: 'Volunteer',
      },
    })
  ).person;
  const actor = await loadActor(fixture.db, fixture.admin.person.id);
  assert.ok(actor);
  await saveTaskCheckinSource(
    fixture.db,
    {
      sourceId,
      workspaceId: 'workspace',
      expectedRevision: 0,
      enabled: false,
      actorId: actor.personId,
      policy: {
        ...taskPolicy,
        cohortPersonIds: [wrong.id, right.id],
        serviceOwnerId: actor.personId,
        supportPersonIds: [actor.personId],
      },
    },
    now,
  );
  await upsertNotionTaskSnapshot(
    fixture.db,
    {
      sourceId,
      taskId: '10000000-0000-4000-8000-000000000002',
      revision: 'v1',
      sourceEditedAt: now.toISOString(),
      active: true,
      snapshot: {
        title: 'Plan the committee meeting',
        assigneeIds: ['notion-volunteer'],
        assigneeLabels: [{ id: 'notion-volunteer', name: 'Alex Committee Volunteer' }],
      },
    },
    now,
  );
  await confirmTaskCheckinMapping(
    fixture.db,
    actor,
    { sourceId, expectedRevision: 1, notionUserId: 'notion-volunteer', personId: wrong.id },
    now,
  );
  for (const [person, discord] of [
    [wrong, '111111111111111111'],
    [right, '333333333333333333'],
  ] as const) {
    await service.linkIdentity(person.id, {
      platform: 'discord',
      externalId: discord,
      linkMethod: 'self_linked',
    });
    await setTaskCheckinConsent(
      fixture.db,
      {
        sourceId,
        personId: person.id,
        discordUserId: discord,
        state: 'active',
        policyRevision: 1,
        interactionId: discord,
      },
      now,
    );
  }
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
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
  await page.goto(`${ORIGIN}/task-checkins/?source=${sourceId}`);
  await page.getByRole('link', { name: 'Account matches', exact: true }).click();
  assert.ok((await page.locator('main').innerText()).includes('Alex Committee Volunteer'));
  assert.ok((await page.locator('main').innerText()).includes(wrong.email ?? ''));
  await page.getByRole('link', { name: 'Review match', exact: true }).click();
  const stale = await context.newPage();
  await stale.goto(page.url());
  await page
    .getByRole('textbox', { name: 'Search LVBT records', exact: true })
    .fill(right.email ?? '');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator(`input[type=radio][value="${right.id}"]`).check();
  await page.getByRole('button', { name: 'Change person match', exact: true }).click();
  assert.ok(page.url().includes('saved=1'), await page.locator('body').innerText());
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT person_id FROM task_checkin_mappings')
        .first<{ person_id: string }>()
    )?.person_id,
    right.id,
  );
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT count(*) AS n FROM task_checkin_consents WHERE state='active'")
        .first<{ n: number }>()
    )?.n,
    0,
  );
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT count(*) AS n FROM task_checkin_consent_receipts')
        .first<{ n: number }>()
    )?.n,
    2,
  );
  await stale.locator(`input[type=radio][value="${wrong.id}"]`).check();
  await stale.getByRole('button', { name: 'Change person match', exact: true }).click();
  assert.ok((await stale.getByRole('alert').innerText()).includes('changed'));
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT person_id FROM task_checkin_mappings')
        .first<{ person_id: string }>()
    )?.person_id,
    right.id,
  );
  await page.getByRole('link', { name: 'Account matches', exact: true }).click();
  await page.getByRole('link', { name: 'Review match', exact: true }).click();
  assert.ok((await page.locator('main').innerText()).includes(right.email ?? ''));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mkdir(join(fixture.root, 'test-results/staff'), { recursive: true });
  await page.screenshot({
    path: join(fixture.root, 'test-results/staff/task-checkin-mapping-correction-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByText('Remove this match', { exact: true }).click();
  await page.getByRole('button', { name: 'Remove match', exact: true }).click();
  assert.ok(page.url().includes('saved=1'));
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT count(*) AS n FROM task_checkin_mappings')
        .first<{ n: number }>()
    )?.n,
    0,
  );
  assert.ok((await page.locator('main').innerText()).includes('Alex Committee Volunteer'));
  for (const id of [wrong.id, right.id])
    assert.equal(
      (
        await fixture.db
          .prepare('SELECT membership_status FROM people WHERE id=?')
          .bind(id)
          .first<{ membership_status: string }>()
      )?.membership_status,
      'not_member',
    );
  await context.close();
  process.stdout.write(
    'Staff mapping correction passed: named review, same-name people, fresh consent required, stale-form rejection and removal.\n',
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
