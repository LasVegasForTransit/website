import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import {
  ensureTaskCard,
  attachTaskCardMessage,
} from '@lasvegasfortransit/platform-storage/notion-task-cards';
import {
  setTaskCheckinConsent,
  upsertNotionTaskSnapshot,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { ORIGIN, type startRuntime } from './runtime';
type Fixture = Awaited<ReturnType<typeof startRuntime>>;
export async function exerciseDeliveryRecovery(input: {
  fixture: Fixture;
  guest: { id: string };
  page: Page;
  sourceId: string;
}) {
  const { fixture, guest, page, sourceId } = input;
  const version = await fixture.db
    .prepare('SELECT revision FROM task_checkin_sources WHERE id=?')
    .bind(sourceId)
    .first<{ revision: number }>();
  assert.ok(version);
  await new PersonService(fixture.db).linkIdentity(guest.id, {
    platform: 'discord',
    externalId: '333333333333333334',
    linkMethod: 'self_linked',
  });
  assert.equal(
    await setTaskCheckinConsent(
      fixture.db,
      {
        sourceId,
        personId: guest.id,
        discordUserId: '333333333333333334',
        interactionId: '900000000000000001',
        state: 'active',
        policyRevision: version.revision,
      },
      new Date(),
    ),
    true,
  );
  const deliveredCard = await ensureTaskCard(
    fixture.db,
    { sourceId, taskId: '10000000-0000-4000-8000-000000000002', personId: guest.id },
    new Date(),
  );
  assert.ok(deliveredCard);
  await attachTaskCardMessage(
    fixture.db,
    { token: deliveredCard.token, channelId: 'PRIVATE-CHANNEL', messageId: 'PRIVATE-MESSAGE' },
    new Date(),
  );
  const auxStamp = new Date().toISOString();
  await fixture.db
    .prepare(
      `INSERT INTO task_checkin_digests(id,source_id,person_id,day,policy_revision,consent_revision,notion_user_id,state,reason,next_attempt_at,created_at,updated_at)
    VALUES('uncertain-summary',?,?,?, ?,1,'notion-guest','held','unconfirmed_effect',?,?,?)`,
    )
    .bind(sourceId, guest.id, auxStamp.slice(0, 10), version.revision, auxStamp, auxStamp, auxStamp)
    .run();
  await fixture.db
    .prepare(
      `INSERT INTO task_checkin_card_refreshes(source_id,task_id,person_id,state,reason,next_attempt_at,updated_at)
    VALUES(?,'10000000-0000-4000-8000-000000000002',?,'failed','provider_unavailable',?,?)
    ON CONFLICT(source_id,task_id,person_id) DO UPDATE SET state='failed',reason='provider_unavailable',updated_at=excluded.updated_at`,
    )
    .bind(sourceId, guest.id, auxStamp, auxStamp)
    .run();
  await page.reload();
  assert.ok((await page.locator('body').innerText()).includes('Messages that need another check'));
  assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE-'));
  await mkdir(join(fixture.root, 'test-results/staff'), { recursive: true });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({
    path: join(fixture.root, 'test-results/staff/task-delivery-recovery-mobile.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Retry safely', exact: true }).click();
  assert.equal(
    (await fixture.db.prepare('SELECT state FROM task_checkin_card_refreshes').first())?.state,
    'queued',
  );
  await page.getByRole('button', { name: 'Close without retrying', exact: true }).click();
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT state FROM task_checkin_digests WHERE id='uncertain-summary'")
        .first()
    )?.state,
    'superseded',
  );
  await page.getByRole('link', { name: 'People and reminder choices', exact: true }).click();
  assert.ok((await page.locator('body').innerText()).includes('Enabled'));
  await page.screenshot({
    path: join(fixture.root, 'test-results/staff/task-participant-choices-mobile.png'),
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Back to task check-ins', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}
export async function exerciseReadiness(input: {
  fixture: Fixture;
  page: Page;
  sourceId: string;
  now: Date;
}) {
  const { fixture, page, sourceId, now } = input;
  assert.ok((await page.locator('body').innerText()).includes('No tasks checked yet'));
  await fixture.db
    .prepare(
      `INSERT INTO task_checkin_scans(source_id,scan_id,policy_revision,state,next_attempt_at,reason,updated_at)
    VALUES(?,'browser-scan',1,'scanning',?,'http_403',?)`,
    )
    .bind(sourceId, now.toISOString(), now.toISOString())
    .run();
  await page.reload();
  assert.ok((await page.locator('body').innerText()).includes('Notion connection needs attention'));
  await fixture.db
    .prepare(
      "UPDATE task_checkin_scans SET state='complete',reason=NULL,last_completed_at=? WHERE source_id=?",
    )
    .bind(now.toISOString(), sourceId)
    .run();
  await page.reload();
  assert.ok((await page.locator('body').innerText()).includes('Last checked'));

  assert.equal(
    await page.getByRole('link', { name: 'People and reminder choices', exact: true }).count(),
    1,
  );
  await page.getByRole('link', { name: 'People and reminder choices', exact: true }).click();
  assert.ok((await page.locator('body').innerText()).includes('Not enabled'));
  assert.equal(
    await page.getByRole('button', { name: 'Enable check-ins', exact: true }).count(),
    0,
  );
  await page.getByRole('link', { name: 'Back to task check-ins', exact: true }).click();
  await upsertNotionTaskSnapshot(
    fixture.db,
    {
      sourceId,
      taskId: '10000000-0000-4000-8000-000000000099',
      revision: 'v1',
      sourceEditedAt: now.toISOString(),
      active: false,
      snapshot: {
        title: 'Prepare the volunteer briefing',
        status: 'In progress',
        ineligibleReason: 'unconfirmed_date_range',
      },
    },
    now,
  );
  await page.reload();
  const heldTask = page.getByRole('region', { name: 'Task details to fix', exact: true });
  await heldTask.getByRole('heading', { name: 'Prepare the volunteer briefing' }).waitFor();
  assert.match(
    (await heldTask.getByRole('link', { name: /Open task in Notion/ }).getAttribute('href')) ?? '',
    /10000000000040008000000000000099$/,
  );
  await heldTask.getByRole('link', { name: 'Choose reminder date', exact: true }).click();
  await page.getByLabel('When a deadline is a date range', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '#rangeBoundary');
  assert.equal(new URL(page.url()).searchParams.get('source'), sourceId);
  await page.goto(`${ORIGIN}/task-checkins/?source=${sourceId}`);
}
