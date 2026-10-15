import assert from 'node:assert/strict';
import test from 'node:test';
import { membershipRollFixture as fixture, observedAt } from './support/membership-roll-fixture';
import { processNewsletterPollChoices } from '../src/newsletter-poll-choices';
import { loadNewsletterPlan, newsletterPlanIsCurrent } from '../src/newsletter-plan';
import { claimBeehiivPoll, saveBeehiivPollPage } from '../src/beehiiv-poll-store';
import type { Db } from '../src/db';
async function poll(db: Db, externalId: string, status: string, at: string) {
  const now = new Date(at),
    lease = await claimBeehiivPoll(db, 'pub_fixture', now);
  assert.ok(typeof lease !== 'string');
  await saveBeehiivPollPage(db, lease, {
    rows: [{ id: externalId, status, created: 1767225600 }],
    nextCursor: null,
    now,
  });
}

void test('a confirmed active-to-inactive poll transition withdraws current membership without a fabricated signup', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    db.raw
      .prepare(
        "UPDATE identities SET linked_at='2026-01-01T00:00:00.000Z',updated_at='2026-01-01T00:00:00.000Z' WHERE person_id=?",
      )
      .run(person.id);
    await roll.recordCurrentMembershipRoll(db, input);
    await poll(db, input.externalId, 'active', observedAt);
    await processNewsletterPollChoices(db, {
      publicationId: 'pub_fixture',
      policy: 'staff_review',
      now: new Date('2026-10-14T12:00:00.000Z'),
    });
    assert.equal(
      db.raw.prepare('SELECT state FROM newsletter_poll_choices').get()?.state,
      'applied',
    );
    await poll(db, input.externalId, 'inactive', '2026-10-14T11:00:00.000Z');
    await processNewsletterPollChoices(db, {
      publicationId: 'pub_fixture',
      policy: 'staff_review',
      now: new Date('2026-10-14T12:00:00.000Z'),
    });
    assert.equal((await people.getExactPerson(person.id))?.membership_status, 'former_member');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
    assert.equal(
      db.raw.prepare('SELECT time_basis FROM consent_withdrawals').get()?.time_basis,
      'observed',
    );
    assert.equal((await loadNewsletterPlan(db, person.id))?.desired, 'inactive');
  } finally {
    db.raw.close();
  }
});
void test('an initial inactive poll with no prior active baseline preserves membership and holds conflicting writes', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    db.raw
      .prepare(
        "UPDATE identities SET linked_at='2026-01-01T00:00:00.000Z',updated_at='2026-01-01T00:00:00.000Z' WHERE person_id=?",
      )
      .run(person.id);
    await roll.recordCurrentMembershipRoll(db, input);
    await poll(db, input.externalId, 'inactive', '2026-10-14T11:00:00.000Z');
    await processNewsletterPollChoices(db, {
      publicationId: 'pub_fixture',
      policy: 'staff_review',
      now: new Date('2026-10-14T12:00:00.000Z'),
    });
    assert.equal(
      db.raw.prepare('SELECT state FROM newsletter_poll_choices').get()?.state,
      'needs_review',
    );
    assert.equal((await people.getExactPerson(person.id))?.membership_status, 'member');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_withdrawals').get()?.n, 0);
    const plan = await loadNewsletterPlan(db, person.id);
    assert.ok(plan);
    assert.equal(await newsletterPlanIsCurrent(db, plan, 'pub_fixture'), false);
  } finally {
    db.raw.close();
  }
});
