import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { markOperationFailed } from '@lasvegasfortransit/platform-storage/outbox';
import { recordAccessObservation } from '@lasvegasfortransit/platform-storage/access-observations';
import { ORIGIN, type startRuntime } from '../../support/runtime';
type Fixture = Awaited<ReturnType<typeof startRuntime>>;
async function submit(page: Page, name: string) {
  const [reply] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/access/')),
    page.getByRole('button', { name, exact: true }).click(),
  ]);
  assert.equal(reply.status(), 303, reply.status() === 303 ? '' : await reply.text());
  await page.waitForLoadState('load');
}
export async function exerciseAccountAccess(page: Page, fixture: Fixture) {
  const people = new PersonService(fixture.db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { given_name: 'Recovery', family_name: 'Member', email: 'recovery@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: '888888888888888888',
    linkMethod: 'self_linked',
  });
  const assigned = await fixture.committees.assign({
    personId: person.id,
    committeeId: 'events',
    role: 'member',
    actorId: fixture.admin.person.id,
    operationId: 'recovery-grant',
  });
  assert.equal(assigned.kind, 'ok');
  const team = await fixture.db
    .prepare("SELECT discord_role_id FROM committees WHERE id='events'")
    .first<{ discord_role_id: string }>();
  assert.ok(team);
  const now = new Date();
  assert.equal(
    await recordAccessObservation(fixture.db, {
      personId: person.id,
      targetId: 'events',
      provider: 'discord',
      identityId: '888888888888888888',
      identityEmail: null,
      resourceId: team.discord_role_id,
      contextId: 'fixture-guild',
      generation: 1,
      expectedAccess: true,
      state: 'granted',
      observedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    }),
    true,
  );
  await markOperationFailed(fixture.db, 'recovery-grant', 'permission_denied');
  await page.goto(`${ORIGIN}/access/?person=${person.id}`);
  assert.equal(
    await page.getByText('Confirmed', { exact: true }).count(),
    0,
    'missing runtime configuration must not expose a stored granted confirmation',
  );
  assert.equal(await page.getByText('Updates not set up', { exact: true }).count(), 1);
  await submit(page, 'Try update again');
  assert.equal(
    (
      await fixture.db
        .prepare("SELECT state FROM integration_outbox WHERE id='recovery-grant'")
        .first<{ state: string }>()
    )?.state,
    'queued',
  );
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT ended_at FROM committee_assignments WHERE id=?')
        .bind(assigned.value.id)
        .first<{ ended_at: string | null }>()
    )?.ended_at,
    null,
  );
  await page.locator('.staff-account-removal > summary').click();
  await page.getByLabel('Reason', { exact: true }).selectOption('stepped_back');
  await submit(page, 'Remove from committee');
  const ended = await fixture.db
    .prepare('SELECT ended_at FROM committee_assignments WHERE id=?')
    .bind(assigned.value.id)
    .first<{ ended_at: string }>();
  assert.ok(ended?.ended_at);
  await markOperationFailed(fixture.db, 'recovery-grant', 'provider_unavailable');
  await page.reload();
  assert.equal(
    await page.getByRole('button', { name: 'Try update again', exact: true }).count(),
    0,
  );
  const removal = await fixture.db
    .prepare(
      'SELECT o.id FROM integration_outbox o JOIN reconcile_generations g ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation WHERE o.person_id=? AND o.target_id=?',
    )
    .bind(person.id, 'events')
    .first<{ id: string }>();
  assert.ok(removal);
  await markOperationFailed(fixture.db, removal.id, 'provider_unavailable');
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/access-desktop.png`,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    path: `${fixture.root}/test-results/staff/access-mobile.png`,
    animations: 'disabled',
    fullPage: true,
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await submit(page, 'Try update again');
  assert.equal(
    (
      await fixture.db
        .prepare('SELECT ended_at FROM committee_assignments WHERE id=?')
        .bind(assigned.value.id)
        .first<{ ended_at: string }>()
    )?.ended_at,
    ended.ended_at,
  );
  await page.getByText('Access change history', { exact: true }).click();
  assert.equal(await page.getByText('Account update retried', { exact: true }).count(), 2);
  await page.setViewportSize({ width: 1440, height: 1000 });
}
export async function exerciseLeadAccountAccess(page: Page, fixture: Fixture) {
  await page.goto(`${ORIGIN}/access/?person=${fixture.inside.id}`);
  assert.equal(await page.locator('.staff-account-row').count(), 2);
  assert.equal(
    await page.getByRole('button', { name: 'Try update again', exact: true }).count(),
    0,
  );
  assert.equal(await page.getByText('Remove from committee', { exact: true }).count(), 0);
  await page.getByText('Access change history', { exact: true }).click();
  assert.equal((await page.content()).includes('Advocacy Team'), false);
}
