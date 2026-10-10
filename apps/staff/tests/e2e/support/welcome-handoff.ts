import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { ORIGIN, type startRuntime } from '../../support/runtime';
export async function exerciseWelcomeHandoff(
  page: Page,
  fixture: Awaited<ReturnType<typeof startRuntime>>,
) {
  const people = new PersonService(fixture.db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { given_name: 'New', family_name: 'Volunteer', email: 'handoff@example.invalid' },
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
    details: { interests: ['events', 'volunteering'] },
  });
  const path = `${ORIGIN}/welcome/${person.id}/`;
  await page.goto(path);
  assert.equal(await page.getByRole('link', { name: 'View member profile' }).count(), 0);
  await page.getByRole('button', { name: 'Assign to me', exact: true }).click();
  await page.getByRole('heading', { name: 'Help them get involved' }).waitFor();
  assert.ok((await page.content()).includes('Coming to events, Volunteering on a team'));
  assert.equal(await page.getByLabel('Committee', { exact: true }).locator('option').count(), 2);
  await page.getByLabel('Committee', { exact: true }).selectOption('events');
  const [assigned] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes(`/welcome/${person.id}/`),
    ),
    page.getByRole('button', { name: 'Add to committee', exact: true }).click(),
  ]);
  assert.equal(assigned.status(), 303, assigned.status() === 303 ? '' : await assigned.text());
  await page.waitForURL(`${path}#get-involved`);
  assert.equal(
    await page.getByRole('button', { name: 'Add to committee', exact: true }).count(),
    0,
  );
  assert.ok((await page.content()).includes('In Events Committee.'));
  assert.equal(await page.getByRole('link', { name: 'View member profile' }).count(), 1);
  const assignment = await fixture.db
    .prepare(
      'SELECT role FROM committee_assignments WHERE person_id=? AND committee_id=? AND ended_at IS NULL',
    )
    .bind(person.id, 'events')
    .first<{ role: string }>();
  assert.equal(assignment?.role, 'member');
  assert.equal(
    await fixture.db
      .prepare("SELECT 1 FROM engagement_events WHERE person_id=? AND type='welcomed'")
      .bind(person.id)
      .first(),
    null,
  );
  await page.getByLabel('Contact method').selectOption('in_person');
  await page.getByRole('button', { name: 'Mark welcomed', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/welcome/`);
}
