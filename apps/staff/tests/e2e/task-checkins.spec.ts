import { searchStaffPeople } from '@lasvegasfortransit/platform-storage/staff-people';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import {
  saveTaskCheckinSource,
  upsertNotionTaskSnapshot,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { taskPolicy } from '@lasvegasfortransit/platform-integrations/test-task-policy';
import {
  exerciseDeliveryRecovery,
  exerciseReadiness,
} from '../support/task-checkin-recovery-browser';
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
  const now = new Date();
  const guest = (
    await new PersonService(fixture.db).upsertFromSource({
      source: 'staff',
      fields: {
        email: 'uninterruptedguestaccountreferenceforlayouttestingatmobilewidth@example.invalid',
        given_name: 'Guest',
        family_name: 'Contributor',
      },
    })
  ).person;
  assert.equal(
    guest.email,
    'uninterruptedguestaccountreferenceforlayouttestingatmobilewidth@example.invalid',
  );
  const administrator = await loadActor(fixture.db, fixture.admin.person.id);
  assert.ok(administrator);
  const selected = await searchStaffPeople(fixture.db, administrator, {
    text: guest.email,
    limit: 25,
  });
  assert.equal(
    selected.items.some((person) => person.id === guest.id),
    true,
  );
  await saveTaskCheckinSource(
    fixture.db,
    {
      sourceId,
      workspaceId: 'workspace',
      expectedRevision: 0,
      enabled: false,
      actorId: fixture.admin.person.id,
      policy: {
        ...taskPolicy,
        cohortPersonIds: [fixture.inside.id, guest.id],
        serviceOwnerId: fixture.admin.person.id,
        supportPersonIds: [fixture.admin.person.id],
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
        title: 'Prepare volunteer agenda',
        assigneeIds: ['notion-guest'],
        status: 'In progress',
      },
    },
    now,
  );
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
  const response = await page.goto(`${ORIGIN}/task-checkins/`);
  assert.equal(response?.status(), 200, await page.locator('body').innerText());
  await page.getByRole('heading', { name: 'People to match', exact: true }).waitFor();
  await exerciseReadiness({ fixture, page, sourceId, now });
  await page.getByRole('link', { name: 'Choose person', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search LVBT records' })
    .fill('uninterruptedguestaccountreferenceforlayouttestingatmobilewidth@example.invalid');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  assert.equal(
    await page.getByRole('radio', { name: /Guest Contributor/ }).count(),
    1,
    await page.locator('body').innerText(),
  );
  await page.getByRole('radio', { name: /Guest Contributor/ }).check();
  await page.getByRole('button', { name: 'Confirm person mapping', exact: true }).click();
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT person_id FROM task_checkin_mappings WHERE notion_user_id=?')
        .bind('notion-guest')
        .first<{ person_id: string }>()
    )?.person_id,
    guest.id,
  );
  assert.equal(
    (await new PersonService(fixture.db).getPerson(guest.id))?.membership_status,
    'not_member',
  );
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT count(*) AS n FROM task_checkin_consents WHERE person_id=?')
        .bind(guest.id)
        .first<{ n: number }>()
    )?.n,
    0,
  );
  await page.getByRole('link', { name: 'Check-in settings', exact: true }).click();
  await page.getByLabel('Maximum notifications per person in 24 hours').fill('3');
  await page.getByLabel('Minimum minutes between notifications').fill('90');
  await page.getByLabel('Escalate after this many overdue hours').fill('48');
  await page.getByLabel('Allow delivery after setup', { exact: true }).check();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT enabled FROM task_checkin_sources WHERE id=?')
        .bind(sourceId)
        .first<{ enabled: number }>()
    )?.enabled,
    1,
  );
  await exerciseDeliveryRecovery({ fixture, guest, page, sourceId });
  await page.getByRole('link', { name: 'Check-in settings', exact: true }).click();
  assert.equal(
    await page.getByLabel('Maximum notifications per person in 24 hours').inputValue(),
    '3',
  );
  assert.equal(await page.getByLabel('Minimum minutes between notifications').inputValue(), '90');
  assert.equal(await page.getByLabel('Escalate after this many overdue hours').inputValue(), '48');
  await page.getByLabel('Allow delivery after setup', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT enabled FROM task_checkin_sources WHERE id=?')
        .bind(sourceId)
        .first<{ enabled: number }>()
    )?.enabled,
    0,
  );
  await mkdir(join(fixture.root, 'test-results/staff'), { recursive: true });
  for (const [width, scheme] of [
    [1280, 'light'],
    [320, 'light'],
    [320, 'dark'],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({
      path: join(fixture.root, `test-results/staff/task-checkins-${width}-${scheme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.getByRole('link', { name: 'Check-in settings', exact: true }).click();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll('.staff-checkin-choices')].every(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ),
    true,
    'Person choices must wrap without horizontal scrolling.',
  );
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
    process.stdout.write(
      JSON.stringify(
        await page.evaluate(() =>
          [...document.querySelectorAll('*')]
            .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
            .slice(0, 20)
            .map((element) => ({
              tag: element.tagName,
              className: element.className,
              width: element.getBoundingClientRect().width,
              right: element.getBoundingClientRect().right,
            })),
        ),
      ) + '\n',
    );
    await page.screenshot({
      path: join(fixture.root, 'test-results/staff/task-checkin-settings-overflow.png'),
      fullPage: true,
      animations: 'disabled',
    });
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(fixture.root, 'test-results/staff/task-checkin-settings-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  const recoveryStamp = new Date().toISOString();
  await fixture.db
    .prepare(
      `INSERT INTO task_checkin_operations(id,source_id,task_id,person_id,task_revision,consent_revision,policy_revision,kind,payload_json,state,reason,next_attempt_at,created_at,updated_at)
    VALUES('uncertain-update',?,?,?,'v1',1,1,'progress','{}','held','unconfirmed_effect',?,?,?)`,
    )
    .bind(
      sourceId,
      '10000000-0000-4000-8000-000000000002',
      guest.id,
      recoveryStamp,
      recoveryStamp,
      recoveryStamp,
    )
    .run();
  await page.goto(`${ORIGIN}/task-checkins/?source=${sourceId}`);
  await page.getByRole('button', { name: 'Check Notion again', exact: true }).click();
  assert.equal(
    (await fixture.db.prepare('SELECT state FROM task_checkin_recovery').first<{ state: string }>())
      ?.state,
    'queued',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Check Notion again', exact: true }).isDisabled(),
    true,
  );
  assert.ok((await page.locator('body').innerText()).includes('remains unconfirmed'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(fixture.root, 'test-results/staff/task-checkin-recovery-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Close without retrying', exact: true }).click();
  const closed = await fixture.db
    .prepare("SELECT state,result_json FROM task_checkin_operations WHERE id='uncertain-update'")
    .first<{ state: string; result_json: string | null }>();
  assert.equal(closed?.state, 'superseded');
  assert.equal(closed.result_json, null);
  await fixture.db
    .prepare(
      `INSERT INTO task_checkin_escalations(id,event_key,recipient_key,source_id,task_id,subject_id,
      task_revision,consent_revision,policy_revision,trigger_kind,state,reason,next_attempt_at,created_at,updated_at)
      SELECT 'held-support','support-fixture','unavailable',s.id,'10000000-0000-4000-8000-000000000002',?,
      'v1',1,s.revision,'overdue','held','unconfirmed_effect',?,?,? FROM task_checkin_sources s WHERE s.id=?`,
    )
    .bind(guest.id, now.toISOString(), now.toISOString(), now.toISOString(), sourceId)
    .run();
  await page.goto(`${ORIGIN}/task-checkins/?source=${sourceId}`);
  const supportReview = page.getByRole('region', {
    name: 'Support notifications needing attention',
  });
  assert.equal(
    await supportReview.getByRole('button', { name: 'Retry safely', exact: true }).count(),
    0,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(fixture.root, 'test-results/staff/task-checkin-support-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await supportReview.getByRole('button', { name: 'Close without retrying', exact: true }).click();
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT state FROM task_checkin_escalations WHERE id='held-support'")
        .first<{ state: string }>()
    )?.state,
    'closed',
  );
  await fixture.db
    .prepare(
      `INSERT INTO task_checkin_escalations(id,event_key,recipient_key,source_id,task_id,subject_id,
      task_revision,consent_revision,policy_revision,trigger_kind,state,reason,next_attempt_at,created_at,updated_at)
      SELECT 'provider-support','provider-fixture','review:project',s.id,'10000000-0000-4000-8000-000000000002',?,
      'v1',1,s.revision,'blocker','review','routing_provider_unavailable',?,?,? FROM task_checkin_sources s WHERE s.id=?`,
    )
    .bind(
      guest.id,
      new Date(now.getTime() + 300000).toISOString(),
      now.toISOString(),
      now.toISOString(),
      sourceId,
    )
    .run();
  await fixture.db
    .prepare(
      'INSERT INTO task_checkin_provider_backoffs(source_id,not_before,updated_at) VALUES(?,?,?)',
    )
    .bind(sourceId, new Date(now.getTime() + 300000).toISOString(), now.toISOString())
    .run();
  await page.goto(`${ORIGIN}/task-checkins/?source=${sourceId}`);
  assert.ok((await supportReview.innerText()).includes('This request is saved'));
  assert.ok((await page.locator('body').innerText()).includes('Saved updates remain queued'));
  assert.equal(
    await supportReview.getByRole('button', { name: 'Retry safely', exact: true }).count(),
    0,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(fixture.root, 'test-results/staff/task-checkin-support-provider-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await fixture.db
    .prepare(
      "UPDATE task_checkin_sources SET policy_json=json_set(policy_json,'$.retentionDays',7) WHERE id=?",
    )
    .bind(sourceId)
    .run();
  await fixture.db
    .prepare("UPDATE task_checkin_sources SET enabled=0,policy_json='{}' WHERE id=?")
    .bind(sourceId)
    .run();
  await page.goto(`${ORIGIN}/task-checkins/settings/?source=${sourceId}`);
  assert.equal(await page.getByLabel('Private task history retention in days').inputValue(), '7');
  assert.ok((await page.locator('#retention-help').innerText()).includes('Notion and Discord'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(fixture.root, 'test-results/staff/task-checkin-retention-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  const lead = await browser.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': fixture.lead.assertion },
  });
  await lead.addCookies([
    {
      name: '__Host-lvbt_session',
      value: fixture.lead.session.token,
      url: ORIGIN,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  const denied = await (await lead.newPage()).goto(`${ORIGIN}/task-checkins/`);
  assert.equal(denied?.status(), 403);
  await lead.close();
  await context.close();
  process.stdout.write(
    'Staff task-checkin forms passed: mapping without membership/consent, enable/pause, responsive screenshots, current admin access.\n',
  );
} finally {
  await browser.close();
  await fixture.dispose();
}
