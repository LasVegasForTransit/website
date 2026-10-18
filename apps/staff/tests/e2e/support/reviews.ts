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
  const comparison = page.locator('.staff-review-comparison');
  assert.equal(await comparison.getByText('Different', { exact: true }).count(), 1);
  const expectedFields = ['First name', 'Last name', 'Email', 'Phone', 'ZIP code'];
  const pairs = comparison.locator('.staff-review-field');
  assert.equal(await pairs.count(), 5);
  for (const [index, label] of expectedFields.entries()) {
    const pair = pairs.nth(index);
    assert.ok((await pair.locator('dt').textContent())?.includes(label));
    assert.equal(await pair.locator('dd').count(), 2);
    const first = await pair.locator('dd').nth(0).boundingBox();
    const second = await pair.locator('dd').nth(1).boundingBox();
    assert.ok(first && second);
    assert.ok(
      first.x < second.x && Math.abs(first.y - second.y) < 1,
      'Desktop values align side by side',
    );
  }
  const changed = comparison.locator('.staff-review-field-different');
  assert.equal(await changed.count(), 1);
  assert.equal(
    await changed.evaluate(
      (field) => getComputedStyle(field).backgroundColor !== 'rgba(0, 0, 0, 0)',
    ),
    true,
    'Different fields have a visible background as well as text',
  );
  // Chromium exposes native definition-list labels and values as adjacent text
  // nodes, rather than giving the definition an accessible name.
  const accessibleComparison = await comparison.ariaSnapshot();
  assert.match(
    accessibleComparison,
    /- term: Email Different\n- definition: New entry, Email, duplicate-fixture@example\.invalid\n- definition: Already on our list, Email, inside@example\.invalid/,
  );
  await exerciseEmailConflict(page, fixture);
  await page.getByRole('button', { name: 'Keep separate', exact: true }).waitFor();
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/review-desktop.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const pair of await pairs.all()) {
    const labels = pair.locator('.staff-review-value-label');
    assert.equal(await labels.nth(0).isVisible(), true);
    assert.equal(await labels.nth(1).isVisible(), true);
    const values = pair.locator('.staff-review-value');
    const first = await values.nth(0).boundingBox();
    const second = await values.nth(1).boundingBox();
    assert.ok(first && second);
    const gap = second.y - (first.y + first.height);
    assert.ok(gap >= 0 && gap <= 64, 'Both values for each field stay adjacent on a phone');
    assert.ok(Math.abs(first.x - second.x) < 1, 'Phone values share one readable column');
  }
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/review-mobile.png`,
    fullPage: true,
    animations: 'disabled',
  });
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
