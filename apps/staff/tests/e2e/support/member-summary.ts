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
    fields: {
      given_name: 'Ana',
      family_name: 'Reyes',
      email: 'summary@example.invalid',
      phone: '+17025550100',
      zip: '89104',
    },
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
  for (let i = 0; i < 50; i++) {
    await people.recordEngagement(person.id, {
      type: 'attended',
      source: 'fixture',
      reference: `history-summary-${i}`,
      occurredAt: '2025-01-11T12:00:00Z',
    });
  }
  await page.reload();
  assert.equal(await page.getByText('Email confirmed', { exact: true }).isVisible(), true);
  const summary = page.getByRole('region', { name: 'Member summary', exact: true });
  assert.equal(
    await summary.getByText('Member since Mar 15, 2024', { exact: true }).isVisible(),
    true,
  );
  assert.equal(await summary.getByText('Member', { exact: true }).isVisible(), true);
  assert.equal(await summary.getByText('Mailing list', { exact: true }).count(), 0);
  assert.equal(await summary.getByText('Last recorded activity', { exact: true }).count(), 0);
  assert.equal(await summary.getByText('1 event attended', { exact: true }).count(), 0);
  assert.equal(
    await page.locator('#accounts').count(),
    0,
    'optional Discord should not add an empty support section',
  );
  assert.equal(
    await page
      .getByRole('link', { name: 'Download member record', exact: true })
      .getAttribute('href'),
    `/people/${person.id}/data/`,
  );
  assert.equal(
    await page
      .getByRole('link', { name: 'Download member record', exact: true })
      .evaluate((link) => getComputedStyle(link).textDecorationLine.includes('underline')),
    true,
    'profile links must retain visible link affordances under the staff content security policy',
  );
  assert.equal(
    await summary.evaluate((element) => getComputedStyle(element).display),
    'grid',
    'the membership layout stylesheet must be applied in the compiled staff Worker',
  );
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
    await summary
      .getByText('Unsubscribed from LVBT updates Feb 10, 2025.', { exact: true })
      .isVisible(),
    true,
  );
  assert.equal(await summary.getByText('Former member', { exact: true }).isVisible(), true);
  assert.equal(await summary.getByText('Left mailing list', { exact: true }).count(), 0);
  await fixture.db
    .prepare(
      "UPDATE consent_records SET withdrawn_time_basis='observed' WHERE person_id=? AND withdrawn_at IS NOT NULL",
    )
    .bind(person.id)
    .run();
  await page.reload();
  assert.equal(
    await summary
      .getByText('Unsubscribe recorded Feb 10, 2025. The original change date wasn’t provided.', {
        exact: true,
      })
      .isVisible(),
    true,
  );
  assert.equal(await summary.getByText(/^Left LVBT /).count(), 0);
  await page.getByText('Record history', { exact: true }).click();
  assert.equal(
    await page.getByText('51 events attended', { exact: true }).count(),
    1,
    'activity totals cover older history beyond the current page',
  );
  assert.equal(
    await page.getByRole('heading', { name: 'Activity', exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await page.getByText('Attended an event', { exact: true }).first().isVisible(),
    true,
    'meaningful engagement stays in the record history',
  );
  await people.recordConsent(person.id, { ...consent, givenAt: '2026-01-20T12:00:00Z' });
  await page.reload();
  assert.equal(
    await summary.getByText('Member since Jan 20, 2026', { exact: true }).isVisible(),
    true,
  );
  assert.equal(await summary.getByText('Member since Mar 15, 2024', { exact: true }).count(), 0);
  for (const committeeId of ['events', 'advocacy']) {
    const assigned = await fixture.committees.assign({
      personId: person.id,
      committeeId,
      role: 'member',
      actorId: fixture.admin.person.id,
      operationId: `profile-summary-${committeeId}`,
    });
    assert.equal(assigned.kind, 'ok');
  }
  await page.reload();
  assert.equal(await page.locator('.staff-current-assignments > li').count(), 2);
  assert.equal(
    await page.locator('#accounts details').first().getAttribute('open'),
    null,
    'account support starts folded when no action is needed',
  );
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
    const contact = await page.getByRole('region', { name: 'Contact', exact: true }).boundingBox();
    const committees = await page
      .getByRole('region', { name: 'Committees', exact: true })
      .boundingBox();
    assert.ok(contact && committees);
    assert.equal(Math.round(contact.x), Math.round(committees.x));
    assert.ok(
      committees.y >= contact.y + contact.height,
      'contact and committee work follow the member portal section order',
    );
    const cells = page.locator('.staff-contact-details > div');
    const first = await cells.nth(0).boundingBox();
    const second = await cells.nth(1).boundingBox();
    assert.ok(first && second);
    if (width === 1440) {
      assert.equal(Math.round(first.y), Math.round(second.y));
      assert.ok(second.x > first.x + first.width, 'contact details share a row when there is room');
    } else {
      assert.ok(
        second.y >= first.y + first.height,
        'phone contact details stay grouped and readable',
      );
    }
  }
  await page.goto(`${ORIGIN}/people/?q=summary%40example.invalid`);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
    '32px',
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'multiple committee links and actions must reflow at 200% text on a 320px phone',
  );
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: `${fixture.root}/test-results/staff/member-roster-enlarged-text.png`,
  });
  await page.goto(`${ORIGIN}/people/${person.id}/`);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: `${fixture.root}/test-results/staff/member-summary-dark.png`,
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page
    .getByRole('region', { name: 'Accounts', exact: true })
    .locator('summary')
    .first()
    .click();
  const status = page.locator('.staff-profile-account-state').first();
  assert.equal(await status.isVisible(), true);
  assert.deepEqual(
    await status.evaluate((element) => ({
      tag: element.tagName,
      border: getComputedStyle(element).borderWidth,
      background: getComputedStyle(element).backgroundColor,
    })),
    { tag: 'STRONG', border: '0px', background: 'rgba(0, 0, 0, 0)' },
    'account status must read as text, not an outlined control',
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Edit details', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('summary-corrected@example.invalid');
  await page.getByLabel('Reason for the change').fill('Member supplied a new email address.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('heading', { name: 'Ana Reyes', exact: true }).waitFor();
  assert.equal(await page.getByText('Email confirmed', { exact: true }).count(), 0);
}
