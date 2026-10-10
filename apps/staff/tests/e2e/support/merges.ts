import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { ORIGIN, type startRuntime } from '../../support/runtime';
type Fixture = Awaited<ReturnType<typeof startRuntime>>;
export async function exerciseMerges(page: Page, fixture: Fixture) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const people = new PersonService(fixture.db);
  const { person } = await people.upsertFromSource({
    source: 'paper',
    fields: { given_name: 'Committee', family_name: 'Rider', phone: '+17025550200' },
    consent: {
      scope: 'newsletter',
      source: 'paper',
      method: 'paper_signature',
      wordingVersion: 'fixture-only',
    },
  });
  await page.goto(`${ORIGIN}/review/`);
  await page
    .getByRole('list', { name: 'Possible duplicates', exact: true })
    .getByRole('link')
    .first()
    .click();
  await page.getByText('Combine if they are the same person', { exact: true }).click();
  await page
    .getByLabel('Reason for combining')
    .fill('Member confirmed this paper signup was theirs.');
  const [reply] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('decision=combine'),
    ),
    page.getByRole('button', { name: 'Combine entries', exact: true }).click(),
  ]);
  assert.equal(reply.status(), 303);
  await page.getByRole('heading', { name: 'Entries combined', exact: true }).waitFor();
  assert.ok((await page.content()).includes('Member confirmed this paper signup was theirs.'));
  assert.equal(await people.getPerson(person.id), null);
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/combined-desktop.png`,
    animations: 'disabled',
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/combined-mobile.png`,
    animations: 'disabled',
    fullPage: true,
  });
  await page.getByLabel('Reason for undoing').fill('Staff confirmed these are different people.');
  const [undone] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/combined/'),
    ),
    page.getByRole('button', { name: 'Undo combination', exact: true }).click(),
  ]);
  assert.equal(undone.status(), 303);
  const combinedPath = new URL(page.url()).pathname;
  assert.equal(
    (
      await fixture.simulator.dispatchFetch(`${ORIGIN}${combinedPath}`, {
        headers: {
          'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
          Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
        },
      })
    ).status,
    404,
  );
  await page.getByRole('heading', { name: 'Combination undone', exact: true }).waitFor();
  assert.ok(await people.getPerson(person.id));
  assert.equal(
    (
      await fixture.db
        .prepare(
          "SELECT count(*) AS n FROM staff_audits WHERE action IN ('person.merge','person.unmerge')",
        )
        .first<{ n: number }>()
    )?.n,
    2,
  );
  await verifyErasure(page, fixture, person.id, combinedPath);
}

async function verifyErasure(page: Page, fixture: Fixture, personId: string, combinedPath: string) {
  await new PersonService(fixture.db).deletePerson(personId);
  const erased = await fixture.db
    .prepare('SELECT given_name,phone,erased_at FROM people WHERE id=?')
    .bind(personId)
    .first();
  assert.ok(erased);
  assert.equal(erased.given_name, null);
  assert.equal(erased.phone, null);
  assert.ok(erased.erased_at);
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT moved_rows FROM merges WHERE merged_person_id=?')
        .bind(personId)
        .first()
    )?.moved_rows,
    '{}',
  );
  assert.equal((await page.goto(`${ORIGIN}/people/${personId}/`))?.status(), 404);
  assert.equal((await page.goto(`${ORIGIN}${combinedPath}`))?.status(), 200);
  assert.ok(
    (await page.content()).includes(
      'Saved personal details from this combination have been erased.',
    ),
  );
  assert.equal(await page.locator(`a[href="/people/${personId}/"]`).count(), 0);
  assert.equal(
    await page.getByRole('button', { name: 'Undo combination', exact: true }).count(),
    0,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const table of ['person_erasure_scope', 'person_erasure_copies'])
    assert.equal((await fixture.db.prepare(`SELECT count(*) AS n FROM ${table}`).first())?.n, 0);
}
