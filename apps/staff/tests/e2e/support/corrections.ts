import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { type startRuntime } from '../../support/runtime';
type Fixture = Awaited<ReturnType<typeof startRuntime>>;
async function save(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (reply) =>
        reply.request().method() === 'POST' && new URL(reply.url()).pathname.endsWith('/edit/'),
    ),
    page.getByRole('button', { name: 'Save changes', exact: true }).click(),
  ]);
  return response;
}
export async function exerciseCorrections(page: Page, fixture: Fixture) {
  const profileUrl = page.url();
  const personId = new URL(profileUrl).pathname.split('/')[2];
  assert.ok(personId);
  await page.getByRole('link', { name: 'Edit details', exact: true }).click();
  const editUrl = page.url();
  const stale = await page.context().newPage();
  try {
    await stale.goto(editUrl);
    assert.equal(await page.getByLabel('First name', { exact: true }).inputValue(), 'Rider01234');
    await page.getByLabel('First name', { exact: true }).fill('Corrected Rider');
    await page
      .getByLabel('Reason for the change')
      .fill('Member confirmed first_name at the welcome desk.');
    await page.screenshot({
      path: `${fixture.root}/test-results/staff/correction-desktop.png`,
      animations: 'disabled',
    });
    assert.equal((await save(page)).status(), 303);
    await page.waitForURL((url) => url.pathname === new URL(profileUrl).pathname);
    assert.equal(
      new URL(page.url()).searchParams.get('return_to'),
      new URL(profileUrl).searchParams.get('return_to'),
    );
    await page.getByRole('heading', { name: 'Corrected Rider', exact: true }).waitFor();
    const history = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Activity', exact: true }) });
    await history.getByText('Details', { exact: true }).click();
    assert.ok((await history.textContent())?.includes('Rider01234 → Corrected Rider'));
    assert.ok(
      (await history.textContent())?.includes('Member confirmed first_name at the welcome desk.'),
    );
    await stale.getByLabel('First name', { exact: true }).fill('Stale overwrite');
    await stale.getByLabel('Reason for the change').fill('Old tab');
    assert.equal((await save(stale)).status(), 409);
    await stale.getByRole('alert').waitFor();
    assert.equal(
      await stale.getByLabel('First name', { exact: true }).inputValue(),
      'Stale overwrite',
    );
    assert.equal(await stale.getByRole('button', { name: 'Save changes', exact: true }).count(), 0);
    assert.equal(
      (
        await fixture.db
          .prepare('SELECT given_name FROM people WHERE id=?')
          .bind(personId)
          .first<{ given_name: string }>()
      )?.given_name,
      'Corrected Rider',
    );
    await stale.getByRole('link', { name: 'Reload profile', exact: true }).click();
    assert.equal(
      await stale.getByLabel('First name', { exact: true }).inputValue(),
      'Corrected Rider',
    );
    assert.equal(
      (
        await fixture.db
          .prepare('SELECT count(*) AS n FROM person_corrections WHERE person_id=?')
          .bind(personId)
          .first<{ n: number }>()
      )?.n,
      1,
    );
    await page.goto(editUrl);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({
      path: `${fixture.root}/test-results/staff/correction-mobile.png`,
      fullPage: true,
      animations: 'disabled',
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
  } finally {
    await stale.close();
  }
}
