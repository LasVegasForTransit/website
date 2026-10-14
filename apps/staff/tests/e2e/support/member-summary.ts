import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { ORIGIN, type startRuntime } from '../../support/runtime';
export async function exerciseMemberSummary(
  page: Page,
  fixture: Awaited<ReturnType<typeof startRuntime>>,
) {
  const people = new PersonService(fixture.db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { given_name: 'Ana', family_name: 'Reyes', email: 'summary@example.invalid' },
  });
  const consent = {
    scope: 'newsletter' as const,
    source: 'join_form' as const,
    method: 'checkbox' as const,
    wordingVersion: 'fixture',
  };
  await people.recordConsent(person.id, { ...consent, givenAt: '2024-03-15T12:00:00Z' });
  await page.goto(`${ORIGIN}/people/${person.id}/`);
  assert.equal(await page.getByText('Email confirmed', { exact: true }).count(), 0);
  await people.upsertFromSource({
    source: 'member',
    fields: { email: person.email },
    emailVerified: true,
  });
  await people.recordEngagement(person.id, {
    type: 'attended',
    source: 'fixture',
    occurredAt: '2025-01-12T12:00:00Z',
  });
  await page.reload();
  assert.equal(await page.getByText('Email confirmed', { exact: true }).isVisible(), true);
  const summary = page.getByRole('region', { name: 'Member summary', exact: true });
  assert.equal(
    await summary.getByText('Member since Mar 15, 2024', { exact: true }).isVisible(),
    true,
  );
  assert.equal(await summary.getByText('Signed up for updates', { exact: true }).isVisible(), true);
  assert.equal(await summary.getByText('1 event attended', { exact: true }).isVisible(), true);
  await page.goto(`${ORIGIN}/people/?q=summary%40example.invalid`);
  const activity = page.locator('.staff-roster-activity time');
  assert.equal(await activity.count(), 1);
  assert.match(await activity.innerText(), /^Last activity .+, \d{4}$/);
  await page.getByRole('link', { name: 'Ana Reyes', exact: true }).click();
  await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2025-02-10T12:00:00Z',
  });
  await page.reload();
  assert.equal(
    await summary.getByText('Left LVBT Feb 10, 2025', { exact: true }).isVisible(),
    true,
  );
  assert.equal(await summary.getByText('Left mailing list', { exact: true }).isVisible(), true);
  await people.recordConsent(person.id, { ...consent, givenAt: '2026-01-20T12:00:00Z' });
  await page.reload();
  assert.equal(
    await summary.getByText('Member since Jan 20, 2026', { exact: true }).isVisible(),
    true,
  );
  assert.equal(await summary.getByText('Member since Mar 15, 2024', { exact: true }).count(), 0);
  for (const [name, width] of [
    ['desktop', 1440],
    ['mobile', 320],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({
      animations: 'disabled',
      fullPage: true,
      path: `${fixture.root}/test-results/staff/member-summary-${name}.png`,
    });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: `${fixture.root}/test-results/staff/member-summary-dark.png`,
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Edit details', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('summary-corrected@example.invalid');
  await page.getByLabel('Reason for the change').fill('Member supplied a new email address.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('heading', { name: 'Ana Reyes', exact: true }).waitFor();
  assert.equal(await page.getByText('Email confirmed', { exact: true }).count(), 0);
}
