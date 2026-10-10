import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { WelcomeService } from '@lasvegasfortransit/platform-storage/welcome';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
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
  const row = page.locator('.staff-roster li').filter({ hasText: 'Utility Member' });
  await page.goto(search);
  assert.equal(await page.locator('.staff-search-filters').getAttribute('open'), null);
  assert.match(await row.locator('.staff-roster-status').innerText(), /\bMember\b/);
  const rosterHeadings = await page.locator('.staff-roster-heading span').allTextContents();
  const rosterColumnCount = await page.locator('.staff-roster-heading span').count();
  assert.equal(
    await row.evaluate((element) => element.children.length),
    rosterColumnCount,
    'a linked Discord status should not shift the roster actions under the wrong headings',
  );
  const assignAction = row.getByRole('link', {
    name: 'Add Utility Member to a committee',
    exact: true,
  });
  const initialActionStyle = await assignAction.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderTopWidth,
      minHeight: style.minHeight,
    };
  });
  assert.equal(initialActionStyle.border, '2px');
  assert.equal(initialActionStyle.minHeight, '44px');
  assert.notEqual(initialActionStyle.background, 'rgba(0, 0, 0, 0)');
  await assignAction.hover();
  await page.waitForTimeout(250);
  assert.notEqual(
    await assignAction.evaluate((element) => getComputedStyle(element).backgroundColor),
    initialActionStyle.background,
    'primary roster actions should visibly respond to hover',
  );
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
  assert.equal(
    await row.getByRole('link', { name: 'Add Utility Member to a committee', exact: true }).count(),
    0,
  );
  await row.getByRole('link', { name: 'Welcome Utility Member', exact: true }).click();
  await page.getByRole('button', { name: 'Assign to me', exact: true }).click();
  await page.getByRole('heading', { name: 'Contact details', exact: true }).waitFor();
  await page.goto(search);
  await row
    .getByRole('link', { name: 'Continue welcome for Utility Member', exact: true })
    .waitFor();
  const admin = await loadActor(fixture.db, fixture.admin.person.id);
  const lead = await loadActor(fixture.db, fixture.lead.person.id);
  assert.ok(admin && lead);
  const welcome = new WelcomeService(fixture.db);
  assert.equal(
    (await welcome.release(admin, person.id, { operationId: 'utility-release' })).kind,
    'ok',
  );
  assert.equal((await welcome.claim(lead, person.id, { operationId: 'utility-claim' })).kind, 'ok');
  await page.goto(search);
  await row.getByText('Welcome: Leon Staff', { exact: true }).waitFor();
  assert.equal(
    await row.getByRole('link', { name: 'Welcome Utility Member', exact: true }).count(),
    0,
  );
  assert.equal(
    (
      await welcome.complete(lead, person.id, {
        operationId: 'utility-complete',
        method: 'email',
        note: '',
      })
    ).kind,
    'ok',
  );
  await page.reload();
  assert.equal(await row.getByText('Welcome: Leon Staff', { exact: true }).count(), 0);
  const assignment = await fixture.db
    .prepare('SELECT id FROM committee_assignments WHERE person_id=? AND ended_at IS NULL')
    .bind(person.id)
    .first<{ id: string }>();
  assert.ok(assignment);
  assert.equal(
    (
      await fixture.committees.endAssignment(
        assignment.id,
        'stepped_back',
        admin.personId,
        'utility-end',
      )
    ).kind,
    'ok',
  );
}
