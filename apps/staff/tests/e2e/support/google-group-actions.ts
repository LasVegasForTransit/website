import assert from 'node:assert/strict';
import type { Page, Locator } from '@playwright/test';
import { ORIGIN, type startRuntime } from '../../support/runtime';
type Fixture = Awaited<ReturnType<typeof startRuntime>>;
async function fields(form: Locator, choice: string) {
  const entries = await form
    .locator('input')
    .evaluateAll((inputs) =>
      inputs.map((input) => [(input as HTMLInputElement).name, (input as HTMLInputElement).value]),
    );
  return new URLSearchParams([...entries, ['choice', choice]]);
}
async function submit(page: Page, button: Locator) {
  const [reply] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/access/groups/'),
    ),
    button.click(),
  ]);
  assert.equal(reply.status(), 303, reply.status() === 303 ? '' : await reply.text());
  await page.waitForLoadState('load');
}
export async function exerciseGoogleGroupActions(
  page: Page,
  fixture: Fixture,
  removalPersonId: string,
) {
  const restore = page.getByRole('button', { name: 'Restore Google access', exact: true });
  const original = await fields(restore.locator('xpath=ancestor::form'), 'restore');
  const headers = {
    'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
    Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: ORIGIN,
  };
  const csrf = await fixture.simulator.dispatchFetch(page.url(), {
    method: 'POST',
    headers: { ...headers, Origin: 'https://attacker.example' },
    body: original.toString(),
  });
  assert.equal(csrf.status, 403);
  const forged = new URLSearchParams(original);
  forged.set('person_id', fixture.admin.person.id);
  const denied = await fixture.simulator.dispatchFetch(page.url(), {
    method: 'POST',
    headers,
    body: forged.toString(),
  });
  assert.equal(denied.status, 409);
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT count(*) AS n FROM integration_outbox WHERE id=?')
        .bind(original.get('operation_id'))
        .first<{ n: number }>()
    )?.n,
    0,
  );
  await submit(page, restore);
  assert.equal(
    await page
      .getByText('Update requested. Waiting for Google to confirm.', { exact: true })
      .count(),
    1,
  );
  assert.equal(await page.getByText('Missing Google access', { exact: true }).isVisible(), true);
  assert.equal(
    await page.getByRole('button', { name: 'Restore Google access', exact: true }).count(),
    0,
  );
  const replay = await fixture.simulator.dispatchFetch(page.url(), {
    method: 'POST',
    headers,
    body: original.toString(),
  });
  assert.equal(replay.status, 409);
  const queued = await fixture.db
    .prepare('SELECT state FROM integration_outbox WHERE id=?')
    .bind(original.get('operation_id'))
    .first<{ state: string }>();
  assert.equal(queued?.state, 'queued');
  const alice = page
    .locator('.staff-google-people-list > li')
    .filter({ has: page.getByRole('link', { name: 'Alex Volunteer', exact: true }) });
  await alice.getByText('Remove Google access', { exact: true }).click();
  const removal = await fields(alice.locator('form'), 'remove');
  await submit(page, alice.getByRole('button', { name: 'Confirm removal', exact: true }));
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT state FROM integration_outbox WHERE id=?')
        .bind(removal.get('operation_id'))
        .first<{ state: string }>()
    )?.state,
    'queued',
  );
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT membership_status FROM people WHERE id=?')
        .bind(removalPersonId)
        .first<{ membership_status: string }>()
    )?.membership_status,
    'member',
  );
  await fixture.db
    .prepare(
      "UPDATE integration_outbox SET state='retry',payload=json_set(payload,'$.googleReview',json(?)) WHERE id=?",
    )
    .bind(
      JSON.stringify({
        reason: 'inherited_access',
        groupEmail: 'preview-events@lasvegasfortransit.org',
      }),
      removal.get('operation_id'),
    )
    .run();
  await page.reload();
  assert.equal(
    await alice
      .getByText(
        'Google access comes through another group. Review their groups in Google Admin.',
        { exact: true },
      )
      .isVisible(),
    true,
  );
  assert.equal(await alice.getByText('Remove Google access', { exact: true }).count(), 0);
  assert.equal(
    await alice.getByText('The update couldn’t be completed. Try again.', { exact: true }).count(),
    0,
  );
  assert.equal(
    await alice
      .getByRole('link', { name: 'Review groups in Google Admin', exact: true })
      .getAttribute('href'),
    'https://admin.google.com/ac/groups',
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/google-group-inherited-dark.png`,
    fullPage: true,
    animations: 'disabled',
  });
  const amina = page
    .locator('.staff-google-people-list > li')
    .filter({ has: page.getByRole('link', { name: 'Amina Staff', exact: true }) });
  await submit(page, amina.getByRole('button', { name: 'Add to committee', exact: true }));
  const added = await fixture.db
    .prepare(
      "SELECT assigned_by FROM committee_assignments WHERE person_id=? AND committee_id='events' AND ended_at IS NULL",
    )
    .bind(fixture.admin.person.id)
    .first<{ assigned_by: string }>();
  assert.equal(added?.assigned_by, fixture.admin.person.id);
  assert.equal(await page.getByRole('link', { name: 'Amina Staff', exact: true }).count(), 0);
  const inside = await fixture.db
    .prepare(
      'SELECT count(*) AS n FROM committee_assignments WHERE person_id=? AND ended_at IS NULL',
    )
    .bind(fixture.inside.id)
    .first<{ n: number }>();
  assert.equal(inside?.n, 1, 'correcting another person must keep existing committee assignments');
}
