import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { ORIGIN, type startRuntime } from '../../support/runtime';
type Fixture = Awaited<ReturnType<typeof startRuntime>>;

async function utilityMember(fixture: Fixture) {
  const people = new PersonService(fixture.db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'utility@example.invalid', given_name: 'Utility', family_name: 'Member' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.recordEngagement(person.id, {
    type: 'joined',
    source: 'join_form',
    occurredAt: new Date().toISOString(),
    details: { interests: ['events'] },
  });
  return person;
}

export async function exerciseRosterUtility(page: Page, fixture: Fixture) {
  const person = await utilityMember(fixture);
  const search = `${ORIGIN}/people/?q=utility%40example.invalid`;
  const row = page.locator('.staff-roster tbody tr').filter({ hasText: 'Utility Member' });
  await page.goto(search);
  assert.equal(await page.locator('.staff-search-filters').getAttribute('open'), null);
  assert.match(await row.locator('.staff-roster-status').innerText(), /\bMember\b/);
  const rosterHeadings = await page.locator('.staff-roster thead th').allTextContents();
  assert.equal(
    await row.evaluate((element) => element.children.length),
    rosterHeadings.length,
    'each member row should line up with the labeled roster columns',
  );
  const assignAction = row.getByRole('link', {
    name: 'Add Utility Member to a committee',
    exact: true,
  });
  const initialActionStyle = await assignAction.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      minHeight: style.minHeight,
      color: style.color,
      underline: style.textDecorationLine,
    };
  });
  assert.equal(initialActionStyle.minHeight, '44px');
  assert.notEqual(initialActionStyle.color, 'rgba(0, 0, 0, 0)');
  assert.equal(initialActionStyle.underline, 'underline');
  await row.getByRole('link', { name: 'Utility Member', exact: true }).click();
  assert.equal(
    new URL(page.url()).searchParams.get('return_to'),
    '/people/?q=utility%40example.invalid',
  );
  await page.getByRole('link', { name: 'Edit details', exact: true }).click();
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await page.getByRole('link', { name: '← Members', exact: true }).click();
  assert.equal(page.url(), search);
  await assignAction.click();
  assert.equal(new URL(page.url()).hash, '#committees-heading');
  await page.getByLabel('Committee', { exact: true }).selectOption('events');
  const [assigned] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/people/'),
    ),
    page.getByRole('button', { name: 'Add to committee', exact: true }).click(),
  ]);
  assert.equal(assigned.status(), 303);
  assert.equal(assigned.headers().location, '/people/?q=utility%40example.invalid#main');
  await page.waitForURL(`${search}#main`);
  await row.getByText('Events Committee', { exact: true }).waitFor();
  const addAnother = row.getByRole('link', {
    name: 'Add another committee for Utility Member',
    exact: true,
  });
  await addAnother.click();
  await page.getByLabel('Committee', { exact: true }).selectOption('advocacy');
  const [addedAgain] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/people/'),
    ),
    page.getByRole('button', { name: 'Add to committee', exact: true }).click(),
  ]);
  assert.equal(addedAgain.status(), 303);
  await page.waitForURL(`${search}#main`);
  assert.deepEqual(await row.locator('.staff-committee-chips li').allTextContents(), [
    'Advocacy Team',
    'Events Committee',
  ]);
  assert.equal(
    await row
      .getByRole('link', {
        name: 'Add Utility Member to a committee',
        exact: true,
      })
      .count(),
    0,
  );
  assert.equal(
    await row.getByRole('link', { name: /Welcome .*Utility Member/ }).count(),
    0,
    'welcome follow-up belongs in its dedicated queue, not on every roster row',
  );
  await page.getByRole('link', { name: 'Welcome', exact: true }).waitFor();
  const assignments = await fixture.db
    .prepare('SELECT id FROM committee_assignments WHERE person_id=? AND ended_at IS NULL')
    .bind(person.id)
    .all<{ id: string }>();
  assert.equal(assignments.results.length, 2);
  for (const [index, assignment] of assignments.results.entries()) {
    assert.equal(
      (
        await fixture.committees.endAssignment(
          assignment.id,
          'stepped_back',
          fixture.admin.person.id,
          `utility-end-${index}`,
        )
      ).kind,
      'ok',
    );
  }
}
