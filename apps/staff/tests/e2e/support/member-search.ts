import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { ORIGIN, type startRuntime } from '../../support/runtime';
type Fixture = Awaited<ReturnType<typeof startRuntime>>;
export async function exerciseMemberSearch(page: Page, fixture: Fixture) {
  const people = new PersonService(fixture.db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'former-search@example.invalid', given_name: 'Search Former' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  await page.goto(`${ORIGIN}/people/`);
  assert.equal(await page.locator('.staff-roster-status').count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Search Former', exact: true }).count(), 0);
  await page.getByLabel('Name or email').fill('former-search@example.invalid');
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('q') === 'former-search@example.invalid'),
    page.getByRole('button', { name: 'Search', exact: true }).click(),
  ]);
  const row = page.locator('.staff-roster li').filter({ hasText: 'Search Former' });
  await row.getByRole('link', { name: 'Search Former', exact: true }).waitFor();
  assert.equal(await row.getByText('Former member', { exact: true }).count(), 1);
  assert.equal(
    await row.getByRole('link', { name: 'Add Search Former to a committee', exact: true }).count(),
    0,
  );
  assert.equal(
    await row.getByRole('link', { name: 'Welcome Search Former', exact: true }).count(),
    0,
  );
  await page.locator('.staff-search-filters > summary').click();
  await page.getByLabel('Membership', { exact: true }).selectOption('member');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('heading', { name: 'No matches', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Include former members and other records' }).click();
  await page.getByRole('link', { name: 'Search Former', exact: true }).waitFor();
  const scoped = await fixture.simulator.dispatchFetch(
    `${ORIGIN}/people/?q=former-search%40example.invalid`,
    {
      headers: {
        'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
        Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
      },
    },
  );
  assert.equal(scoped.status, 200);
  const html = await scoped.text();
  assert.equal(html.includes('former-search@example.invalid</p>'), false);
  assert.equal(html.includes('Search Former'), false);
  await page.goto(`${ORIGIN}/people/`);
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => (document.activeElement as HTMLElement).innerText.trim()),
    'Skip to content',
  );
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'main');
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => (document.activeElement as HTMLAnchorElement).href),
    `${ORIGIN}/people/?committee=unassigned`,
  );
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'q');
  await page.keyboard.type('former-search@example.invalid');
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('q') === 'former-search@example.invalid'),
    page.keyboard.press('Enter'),
  ]);
  assert.equal(await page.getByRole('link', { name: 'Search Former', exact: true }).count(), 1);
}
