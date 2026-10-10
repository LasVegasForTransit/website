import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import type { startRuntime } from '../../support/runtime';
type Fixture = Awaited<ReturnType<typeof startRuntime>>;
async function submit(page: Page, name: string) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (item) => item.request().method() === 'POST' && item.url().includes('/people/'),
    ),
    page.getByRole('button', { name, exact: true }).click(),
  ]);
  assert.equal(response.status(), 303);
  await page.waitForLoadState('load');
}
export async function exerciseCommittees(page: Page, fixture: Fixture) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(new URL('/people/', page.url()).href);
  await page.getByRole('link', { name: 'No committee yet', exact: true }).click();
  await page.getByLabel('Name or email').fill('New');
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('committee') === 'unassigned'),
    page.getByRole('button', { name: 'Search', exact: true }).click(),
  ]);
  await page.getByRole('link', { name: 'New Member', exact: true }).click();
  await page.getByRole('heading', { name: 'Committees', exact: true }).waitFor();
  await page.getByLabel('Committee', { exact: true }).selectOption('events');
  await submit(page, 'Add to committee');
  const current = page.locator('.staff-current-assignments');
  assert.ok((await current.textContent())?.includes('Events Committee'));
  assert.equal((await current.textContent())?.includes('Account update queued'), false);
  assert.equal(
    await page.getByLabel('Committee', { exact: true }).locator('option[value="events"]').count(),
    0,
  );
  const profileUrl = page.url();
  await page.goto(new URL('/people/?q=New&committee=unassigned', page.url()).href);
  assert.equal(await page.getByRole('link', { name: 'New Member', exact: true }).count(), 0);
  await page.goto(profileUrl);
  await current.getByText('Change role or remove', { exact: true }).click();
  await page.getByLabel('Role in Events Committee', { exact: true }).selectOption('lead');
  await submit(page, 'Save role');
  assert.ok((await current.locator('li > p').first().textContent())?.includes('Committee lead'));
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/person-desktop.png`,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/person-mobile.png`,
    animations: 'disabled',
    fullPage: true,
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await current.getByText('Change role or remove', { exact: true }).click();
  await page
    .getByLabel('Reason for leaving Events Committee', { exact: true })
    .selectOption('stepped_back');
  await submit(page, 'Remove from committee');
  assert.equal(await current.locator('li').count(), 0);
  await page.getByText('Past committees', { exact: true }).click();
  assert.ok(
    (await page.locator('.staff-past-assignments').textContent())?.includes('Stepped back'),
  );
  const rows = await fixture.db
    .prepare(
      'SELECT action,actor_id FROM staff_audits WHERE target_id=? AND action LIKE ? ORDER BY occurred_at,id',
    )
    .bind(fixture.welcomePerson.id, 'committee.%')
    .all<{ action: string; actor_id: string }>();
  assert.deepEqual(rows.results.map((row) => row.action).sort(), [
    'committee.assign',
    'committee.change',
    'committee.end',
  ]);
  assert.ok(rows.results.every((row) => row.actor_id === fixture.admin.person.id));
  await page.setViewportSize({ width: 1440, height: 1000 });
}

export async function exerciseLeadCommittees(page: Page, fixture: Fixture) {
  const outside = await fixture.committees.assign({
    personId: fixture.inside.id,
    committeeId: 'advocacy',
    role: 'member',
    actorId: fixture.admin.person.id,
    operationId: 'outside-lead-scope',
  });
  assert.equal(outside.kind, 'ok');
  await page.reload();
  assert.equal(await page.getByText('Change role or remove', { exact: true }).count(), 1);
  await page.getByText('Change role or remove', { exact: true }).click();
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Save role', exact: true }) });
  await form.evaluate((element, id) => {
    const input = element.querySelector<HTMLInputElement>('input[name="assignment_id"]');
    if (!input) throw new Error('Assignment form is missing its target');
    input.value = id;
  }, outside.value.id);
  await page.getByLabel('Role in Events Committee', { exact: true }).selectOption('lead');
  const [denied] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/people/'),
    ),
    page.getByRole('button', { name: 'Save role', exact: true }).click(),
  ]);
  assert.equal(denied.status(), 403);
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT role FROM committee_assignments WHERE id=?')
        .bind(outside.value.id)
        .first<{ role: string }>()
    )?.role,
    'member',
  );
}
