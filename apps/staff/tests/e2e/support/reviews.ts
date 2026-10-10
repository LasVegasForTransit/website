import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { ORIGIN, type startRuntime } from '../../support/runtime';
type Fixture = Awaited<ReturnType<typeof startRuntime>>;
async function exerciseEmailConflict(page: Page, fixture: Fixture) {
  await page.getByText('Combine if they are the same person', { exact: true }).click();
  await page.getByLabel('Reason for combining').fill('Checking the two email addresses.');
  const [reply] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('decision=combine'),
    ),
    page.getByRole('button', { name: 'Combine entries', exact: true }).click(),
  ]);
  assert.equal(reply.status(), 409);
  assert.match(await page.getByRole('alert').innerText(), /can’t be combined/);
  assert.equal(
    (await page.getByLabel('Reason for combining').inputValue()).trim(),
    'Checking the two email addresses.',
  );
  assert.equal(
    (await fixture.db.prepare('SELECT count(*) AS n FROM merges').first<{ n: number }>())?.n,
    0,
  );
  await page.goto(`${ORIGIN}${new URL(page.url()).pathname}`);
}
export async function exerciseReviews(page: Page, fixture: Fixture) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${ORIGIN}/review/`);
  assert.equal(
    await page
      .getByRole('list', { name: 'Possible duplicates', exact: true })
      .getByRole('link')
      .count(),
    2,
  );
  await page
    .getByRole('list', { name: 'Possible duplicates', exact: true })
    .getByRole('link')
    .first()
    .click();
  assert.equal(
    await page.getByRole('heading', { name: 'Committee Rider', exact: true }).count(),
    2,
  );
  assert.ok((await page.content()).includes('duplicate-fixture@example.invalid'));
  assert.ok((await page.content()).includes('inside@example.invalid'));
  await exerciseEmailConflict(page, fixture);
  await page.getByRole('button', { name: 'Keep separate', exact: true }).waitFor();
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/review-desktop.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/review-mobile.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByLabel('Note (optional)').fill('Confirmed these are two different members.');
  const [reply] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/review/'),
    ),
    page.getByRole('button', { name: 'Keep separate', exact: true }).click(),
  ]);
  assert.equal(reply.status(), 303);
  await page.getByRole('heading', { name: 'Kept as two people', exact: true }).waitFor();
  assert.equal(
    (
      await fixture.db
        .prepare(
          "SELECT count(*) AS n FROM review_queue WHERE candidate_person_id=? AND resolved_by=? AND resolution='kept_separate'",
        )
        .bind(fixture.reviewPerson.id, fixture.admin.person.id)
        .first<{ n: number }>()
    )?.n,
    2,
  );
  await page.getByRole('link', { name: 'Back to possible duplicates', exact: true }).click();
  await page
    .getByRole('heading', { name: 'No possible duplicates to check', exact: true })
    .waitFor();
}
