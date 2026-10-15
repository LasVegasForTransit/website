import { membershipRollFixture as fixture, observedAt } from './support/membership-roll-fixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNewsletterPlan, newsletterPlanIsCurrent } from '../src/newsletter-plan';
import { engagementCounts } from '../src/engagement';
import { queryBudget } from '../src/query-budget';
import type { Db } from '../src/db';
import { WelcomeService } from '../src/welcome';
import { loadActor } from '../src/staff-roles';

void test('current membership survives recalculation without creating consent or a joining date', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    const budget = queryBudget(db);
    assert.equal(await roll.recordCurrentMembershipRoll(budget.db, input), 'applied');
    assert.equal((await people.getExactPerson(person.id))?.membership_status, 'member');
    await people.recordConsent(person.id, {
      scope: 'event_reminders',
      source: 'account',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: observedAt,
    });
    assert.equal((await people.getExactPerson(person.id))?.membership_status, 'member');
    assert.equal((await people.getExactPerson(person.id))?.membership_rules_version, 2);
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM consent_records WHERE scope='newsletter'").get()?.n,
      0,
    );
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM engagement_events WHERE type='subscribed'").get()
        ?.n,
      0,
    );
    assert.equal((await engagementCounts(db, person.id)).member_since, null);
    const plan = await loadNewsletterPlan(db, person.id);
    assert.ok(plan);
    assert.equal(plan.desired, 'active');
    assert.equal(plan.allowActivation, false);
    assert.ok(plan);
    assert.equal(await newsletterPlanIsCurrent(db, plan, 'pub_fixture'), true);
    assert.ok(budget.queries <= 8);
  } finally {
    db.raw.close();
  }
});
void test('a real opt-out deactivates current membership and an old active observation cannot restore it', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    await roll.recordCurrentMembershipRoll(db, input);
    const plan = await loadNewsletterPlan(db, person.id);
    assert.ok(plan);
    await people.withdrawConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: '2026-10-14T11:00:00.000Z',
    });
    assert.equal((await people.getExactPerson(person.id))?.membership_status, 'former_member');
    assert.equal((await loadNewsletterPlan(db, person.id))?.desired, 'inactive');
    assert.equal(await newsletterPlanIsCurrent(db, plan, 'pub_fixture'), false);
    assert.equal(await roll.recordCurrentMembershipRoll(db, input), 'needs_review');
    assert.equal(
      await roll.recordCurrentMembershipRoll(db, {
        ...input,
        observedAt: '2026-10-14T12:00:00.000Z',
      }),
      'needs_review',
    );
    assert.equal((await people.getExactPerson(person.id))?.membership_status, 'former_member');
  } finally {
    db.raw.close();
  }
});
void test('replays do not enqueue work and older or contradictory observations do not overwrite the current roll', async () => {
  const { db, input, roll } = await fixture();
  try {
    assert.equal(await roll.recordCurrentMembershipRoll(db, input), 'applied');
    const before = db.raw.prepare('SELECT count(*) AS n FROM integration_outbox').get()?.n;
    assert.equal(await roll.recordCurrentMembershipRoll(db, input), 'already_applied');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM integration_outbox').get()?.n, before);
    assert.equal(
      await roll.recordCurrentMembershipRoll(db, {
        ...input,
        observedAt: '2026-10-14T09:00:00.000Z',
      }),
      'needs_review',
    );
    assert.equal(
      await roll.recordCurrentMembershipRoll(db, { ...input, status: 'inactive' }),
      'needs_review',
    );
    assert.equal(db.raw.prepare('SELECT status FROM membership_roll').get()?.status, 'active');
  } finally {
    db.raw.close();
  }
});
void test('an undated inactive status is held without fabricating a withdrawal or erasing recognized membership', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    await roll.recordCurrentMembershipRoll(db, input);
    assert.equal(
      await roll.recordCurrentMembershipRoll(db, {
        ...input,
        status: 'inactive',
        observedAt: '2026-10-14T12:00:00.000Z',
      }),
      'needs_review',
    );
    assert.equal((await people.getExactPerson(person.id))?.membership_status, 'member');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_withdrawals').get()?.n, 0);
    const held = await loadNewsletterPlan(db, person.id);
    assert.ok(held);
    assert.equal(await newsletterPlanIsCurrent(db, held, 'pub_fixture'), false);
  } finally {
    db.raw.close();
  }
});
void test('a dated source opt-out ends recognized membership without inventing prior consent', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    await roll.recordCurrentMembershipRoll(db, input);
    assert.equal(
      await roll.recordCurrentMembershipRoll(db, {
        ...input,
        status: 'inactive',
        observedAt: '2026-10-14T11:00:00.000Z',
      }),
      'needs_review',
    );
    const withdrawal = {
      ...input,
      status: 'inactive' as const,
      observedAt: '2026-10-14T12:00:00.000Z',
      withdrawnAt: '2026-10-14T11:00:00.000Z',
      sourceCreatedAt: '2026-01-01T00:00:00.000Z',
    };
    assert.equal(await roll.recordCurrentMembershipRoll(db, withdrawal), 'applied');
    assert.equal((await people.getExactPerson(person.id))?.membership_status, 'former_member');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
    const choice = db.raw
      .prepare('SELECT withdrawn_at,time_basis,source_occurred_at FROM consent_withdrawals')
      .get();
    assert.deepEqual(
      { ...choice },
      {
        withdrawn_at: '2026-10-14T11:00:00.000Z',
        time_basis: 'choice',
        source_occurred_at: '2026-10-14T11:00:00.000Z',
      },
    );
    assert.equal((await engagementCounts(db, person.id)).member_since, null);
    assert.equal(await roll.recordCurrentMembershipRoll(db, withdrawal), 'already_applied');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_withdrawals').get()?.n, 1);
  } finally {
    db.raw.close();
  }
});
void test('a real newer signup resolves a held undated status without rewriting the old history', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    await roll.recordCurrentMembershipRoll(db, input);
    assert.equal(
      await roll.recordCurrentMembershipRoll(db, {
        ...input,
        status: 'inactive',
        observedAt: '2026-10-14T11:00:00.000Z',
      }),
      'needs_review',
    );
    await people.recordConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: '2026-10-14T12:00:00.000Z',
      renew: true,
    });
    const plan = await loadNewsletterPlan(db, person.id);
    assert.ok(plan);
    assert.equal(plan.allowActivation, true);
    assert.equal(await newsletterPlanIsCurrent(db, plan, 'pub_fixture'), true);
    assert.equal((await engagementCounts(db, person.id)).member_since, '2026-10-14T12:00:00.000Z');
  } finally {
    db.raw.close();
  }
});
void test('an observation cannot revive an erased profile or take another person’s subscription', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    const { person: other } = await people.upsertFromSource({
      source: 'staff',
      fields: { email: 'other-owner@example.invalid' },
    });
    assert.equal(
      await roll.recordCurrentMembershipRoll(db, { ...input, personId: other.id }),
      'needs_review',
    );
    assert.equal((await people.getExactPerson(other.id))?.membership_status, 'not_member');
    await roll.recordCurrentMembershipRoll(db, input);
    await people.deletePerson(person.id);
    assert.equal(await roll.recordCurrentMembershipRoll(db, input), 'needs_review');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM membership_roll').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
void test('a duplicate review on either side prevents an undated observation from granting membership', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    const { person: other } = await people.upsertFromSource({
      source: 'staff',
      fields: { email: 'other@example.invalid' },
    });
    db.raw
      .prepare(
        "INSERT INTO review_queue(id,candidate_person_id,existing_person_id,reason,created_at,updated_at) VALUES('hold',?,?,'possible_duplicate',?,?)",
      )
      .run(other.id, person.id, observedAt, observedAt);
    assert.equal(await roll.recordCurrentMembershipRoll(db, input), 'needs_review');
    assert.equal((await people.getExactPerson(person.id))?.membership_status, 'not_member');
  } finally {
    db.raw.close();
  }
});
void test('a withdrawal racing the guarded roll write wins atomically', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    let raced = false;
    const interleaved: Db = {
      prepare: (sql) => db.prepare(sql),
      batch: async (statements) => {
        if (!raced) {
          raced = true;
          await people.withdrawConsent(person.id, {
            scope: 'newsletter',
            source: 'account',
            withdrawnAt: '2026-10-14T09:00:00.000Z',
          });
        }
        return db.batch(statements);
      },
    };
    assert.equal(await roll.recordCurrentMembershipRoll(interleaved, input), 'needs_review');
    assert.equal((await people.getExactPerson(person.id))?.membership_status, 'former_member');
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM membership_roll WHERE entitled=1').get()?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});
void test('an unknown joining date remains blank during an individual claimed welcome', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    await roll.recordCurrentMembershipRoll(db, input);
    const { person: staff } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'staff-roll@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    db.raw
      .prepare(
        'INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,?,?)',
      )
      .run(staff.id, staff.id, observedAt);
    const actor = await loadActor(db, staff.id);
    assert.ok(actor);
    const welcome = new WelcomeService(db),
      now = new Date('2026-10-14T12:00:00.000Z');
    assert.equal(
      (await welcome.list(actor, { now })).items.some((value) => value.personId === person.id),
      false,
    );
    const entry = await welcome.entry(actor, person.id, now);
    assert.ok(entry);
    assert.equal(entry.joinedAt, null);
    assert.equal(entry.waitingDays, null);
    assert.equal(await welcome.contact(actor, person.id, now), null);
    assert.equal(
      (await welcome.claim(actor, person.id, { operationId: 'unknown-date-claim', now })).kind,
      'ok',
    );
    assert.equal((await welcome.contact(actor, person.id, now))?.email, 'current@example.invalid');
    assert.equal(
      (
        await welcome.complete(actor, person.id, {
          operationId: 'unknown-date-welcome',
          method: 'email',
          note: '',
          now,
        })
      ).kind,
      'ok',
    );
    assert.equal(await welcome.entry(actor, person.id, now), null);
    assert.equal((await engagementCounts(db, person.id)).member_since, null);
  } finally {
    db.raw.close();
  }
});
void test('a resolved duplicate hold can be retried without inventing new consent', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    const { person: other } = await people.upsertFromSource({
      source: 'staff',
      fields: { email: 'resolved@example.invalid' },
    });
    db.raw
      .prepare(
        "INSERT INTO review_queue(id,candidate_person_id,existing_person_id,reason,created_at,updated_at) VALUES('resolve',?,?,'possible_duplicate',?,?)",
      )
      .run(other.id, person.id, observedAt, observedAt);
    assert.equal(await roll.recordCurrentMembershipRoll(db, input), 'needs_review');
    db.raw
      .prepare(
        "UPDATE review_queue SET resolved_at=?,resolution='kept_separate' WHERE id='resolve'",
      )
      .run(observedAt);
    assert.equal(await roll.recordCurrentMembershipRoll(db, input), 'applied');
    assert.equal((await people.getExactPerson(person.id))?.membership_status, 'member');
  } finally {
    db.raw.close();
  }
});
void test('invalid calendar dates and future observations cannot grant membership', async () => {
  const { db, people, person, input, roll } = await fixture();
  try {
    for (const observation of [
      { ...input, observedAt: new Date(Date.now() + 86_400_000).toISOString() },
      { ...input, sourceCreatedAt: '2026-02-30T00:00:00.000Z' },
      { ...input, sourceCreatedAt: '' },
    ])
      assert.equal(await roll.recordCurrentMembershipRoll(db, observation), 'needs_review');
    assert.equal((await people.getExactPerson(person.id))?.membership_status, 'not_member');
  } finally {
    db.raw.close();
  }
});
