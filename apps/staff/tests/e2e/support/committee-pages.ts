import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { ORIGIN, type startRuntime } from '../../support/runtime';
import { markOperationFailed } from '@lasvegasfortransit/platform-storage/outbox';
type Fixture = Awaited<ReturnType<typeof startRuntime>>;
async function save(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (item) => item.request().method() === 'POST' && item.url().includes('/committees/'),
    ),
    page.getByRole('button', { name: 'Save committee', exact: true }).click(),
  ]);
  await page.waitForLoadState('load');
  return response;
}
export async function exerciseCommitteePages(page: Page, fixture: Fixture) {
  assert.equal(await page.getByRole('link', { name: 'Committees', exact: true }).count(), 1);
  await page.getByRole('link', { name: 'Committees', exact: true }).click();
  const list = page.getByRole('list', { name: 'Committees', exact: true });
  assert.equal(await list.locator('li').count(), 9);
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/committees-desktop.png`,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/committees-mobile.png`,
    animations: 'disabled',
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await list.getByRole('link', { name: 'Events Committee', exact: true }).click();
  const roster = page.getByRole('list', { name: 'Current committee members', exact: true });
  assert.equal(await roster.locator('li').count(), 2);
  assert.ok((await roster.textContent())?.includes('Leon Staff'));
  await page.getByRole('link', { name: 'Edit committee', exact: true }).click();
  const stale = await page.context().newPage();
  try {
    await stale.goto(page.url());
    await page.getByLabel('Description', { exact: true }).fill('Help organize LVBT events.');
    await page.getByLabel('Time commitment', { exact: true }).fill('Two hours a month');
    await page.getByLabel('Accept new assignments', { exact: true }).selectOption('no');
    await page.getByText('Account connections', { exact: true }).click();
    await page
      .getByLabel('Google group email', { exact: true })
      .fill('events@lasvegasfortransit.org');
    await page.getByLabel('Discord role ID', { exact: true }).fill('123456789012345678');
    assert.equal((await save(page)).status(), 303);
    await page.getByRole('heading', { name: 'Events Committee', exact: true }).waitFor();
    assert.ok((await page.textContent('main'))?.includes('Not accepting new assignments'));
    assert.ok((await page.textContent('main'))?.includes('Help organize LVBT events.'));
    assert.equal((await roster.textContent())?.includes('Account update queued'), false);
    const job = await fixture.db
      .prepare(
        "SELECT o.id FROM integration_outbox o JOIN reconcile_generations g ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation WHERE o.person_id=? AND o.target_id='events' ORDER BY o.created_at DESC LIMIT 1",
      )
      .bind(fixture.inside.id)
      .first<{ id: string }>();
    assert.ok(job);
    await markOperationFailed(fixture.db, job.id, 'permission_denied');
    await page.reload();
    await roster
      .getByRole('link', { name: 'Account access needs attention', exact: true })
      .waitFor();
    await stale.getByLabel('Description', { exact: true }).fill('Old tab must not overwrite.');
    assert.equal((await save(stale)).status(), 409);
    assert.equal(
      await stale.getByLabel('Description', { exact: true }).inputValue(),
      'Old tab must not overwrite.',
    );
    assert.equal(
      await stale.getByRole('button', { name: 'Save committee', exact: true }).count(),
      0,
    );
    await page.screenshot({
      path: `${fixture.root}/test-results/staff/committee-mobile.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: `${fixture.root}/test-results/staff/committee-desktop.png`,
      animations: 'disabled',
    });
    await page.goto(`${ORIGIN}/people/${fixture.welcomePerson.id}/`);
    assert.equal(
      await page.getByLabel('Committee', { exact: true }).locator('option[value="events"]').count(),
      0,
    );
    await page.goto(`${ORIGIN}/committees/events/settings/`);
    await page.getByLabel('Accept new assignments', { exact: true }).selectOption('yes');
    assert.equal((await save(page)).status(), 303);
  } finally {
    await stale.close();
  }
}
export async function exerciseLeadCommitteePages(page: Page) {
  await page.goto(`${ORIGIN}/committees/`);
  const list = page.getByRole('list', { name: 'Committees', exact: true });
  assert.equal(await list.locator('li').count(), 1);
  await list.getByRole('link', { name: 'Events Committee', exact: true }).click();
  assert.equal(await page.getByRole('link', { name: 'Edit committee', exact: true }).count(), 0);
  assert.equal((await page.goto(`${ORIGIN}/committees/advocacy/`))?.status(), 404);
  assert.equal((await page.goto(`${ORIGIN}/committees/events/settings/`))?.status(), 404);
}
