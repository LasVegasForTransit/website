import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { claimBeehiivPoll, saveBeehiivPollPage } from '../src/beehiiv-poll-store';
import { loadNewsletterPlan, newsletterPlanIsCurrent } from '../src/newsletter-plan';
import { queryBudget } from '../src/query-budget';

async function fixture() {
  const module = await import('../src/newsletter-poll-choices').catch(() => null);
  assert.ok(module, 'Free-plan observations need guarded consent handling and staff review');
  const db = memoryDb();
  const people = new PersonService(db);
  const now = new Date(Date.now() + 1000);
  const givenAt = new Date(now.getTime() - 3_600_000).toISOString();
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'poll-member@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt,
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'beehiiv',
    externalId: 'sub_poll_fixture',
    externalEmail: person.email ?? '',
    linkMethod: 'verified_email',
  });
  const baseline = new Date(now.getTime() - 30 * 60_000);
  const poll = async (status: string, at: Date) => {
    const scan = await claimBeehiivPoll(db, 'pub_poll_fixture', at);
    assert.ok(typeof scan !== 'string');
    await saveBeehiivPollPage(db, scan, {
      rows: [{ id: 'sub_poll_fixture', status, created: Math.floor(at.getTime() / 1000) - 7200 }],
      nextCursor: null,
      now: at,
    });
  };
  await poll('active', baseline);
  await module.processNewsletterPollChoices(db, {
    publicationId: 'pub_poll_fixture',
    policy: 'keep_unsubscribed',
    now: baseline,
  });
  return { ...module, db, people, person, now, baseline, poll };
}

void test('a linked unsubscribe changes membership at observation time without inventing the member choice time', async () => {
  const f = await fixture();
  try {
    await f.poll('inactive', f.now);
    const result = await f.processNewsletterPollChoices(queryBudget(f.db, 50).db, {
      publicationId: 'pub_poll_fixture',
      policy: 'keep_unsubscribed',
      now: f.now,
    });
    assert.equal(result.applied, 1);
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'former_member');
    const withdrawal = f.db.raw
      .prepare('SELECT withdrawn_at,time_basis,source_occurred_at FROM consent_withdrawals')
      .get();
    assert.deepEqual(
      { ...withdrawal },
      { withdrawn_at: f.now.toISOString(), time_basis: 'observed', source_occurred_at: null },
    );
    assert.equal(
      f.db.raw
        .prepare("SELECT count(*) AS n FROM engagement_events WHERE type='unsubscribed'")
        .get()?.n,
      1,
    );
    await f.poll('inactive', new Date(f.now.getTime() + 16 * 60_000));
    assert.equal(
      (
        await f.processNewsletterPollChoices(f.db, {
          publicationId: 'pub_poll_fixture',
          policy: 'keep_unsubscribed',
          now: new Date(f.now.getTime() + 16 * 60_000),
        })
      ).processed,
      0,
    );
    assert.equal(
      f.db.raw
        .prepare("SELECT count(*) AS n FROM engagement_events WHERE type='unsubscribed'")
        .get()?.n,
      1,
    );
  } finally {
    f.db.raw.close();
  }
});

for (const policy of ['keep_unsubscribed', 'staff_review'] as const) {
  void test(`a signup within an unknown unsubscribe interval follows the selected policy and stays available for review; ${policy}`, async () => {
    const f = await fixture();
    try {
      await f.people.recordConsent(f.person.id, {
        scope: 'newsletter',
        source: 'account',
        method: 'checkbox',
        wordingVersion: 'fixture-rejoin',
        givenAt: new Date(f.now.getTime() - 60_000).toISOString(),
        renew: true,
      });
      await f.poll('inactive', f.now);
      assert.equal(
        (
          await f.processNewsletterPollChoices(f.db, {
            publicationId: 'pub_poll_fixture',
            policy,
            now: f.now,
          })
        ).review,
        1,
      );
      assert.equal(
        (await f.people.getPerson(f.person.id))?.membership_status,
        policy === 'keep_unsubscribed' ? 'former_member' : 'member',
      );
      const plan = await loadNewsletterPlan(f.db, f.person.id);
      assert.ok(plan);
      assert.equal(
        await newsletterPlanIsCurrent(f.db, plan, 'pub_poll_fixture'),
        policy === 'keep_unsubscribed',
      );
      assert.equal(await newsletterPlanIsCurrent(f.db, plan, 'pub_other'), true);
    } finally {
      f.db.raw.close();
    }
  });
}

void test('a signup after the provider read keeps its newer choice and a paused delivery never withdraws consent', async () => {
  const f = await fixture();
  try {
    const observed = new Date(f.now.getTime() - 120_000);
    await f.poll('inactive', observed);
    await f.people.recordConsent(f.person.id, {
      scope: 'newsletter',
      source: 'account',
      method: 'checkbox',
      wordingVersion: 'fixture-rejoin',
      givenAt: new Date(observed.getTime() + 60_000).toISOString(),
      renew: true,
    });
    assert.equal(
      (
        await f.processNewsletterPollChoices(f.db, {
          publicationId: 'pub_poll_fixture',
          policy: 'keep_unsubscribed',
          now: f.now,
        })
      ).ignored,
      1,
    );
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'member');
    await f.poll('paused', new Date(f.now.getTime() + 16 * 60_000));
    assert.equal(
      (
        await f.processNewsletterPollChoices(f.db, {
          publicationId: 'pub_poll_fixture',
          policy: 'keep_unsubscribed',
          now: new Date(f.now.getTime() + 16 * 60_000),
        })
      ).processed,
      0,
    );
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'member');
  } finally {
    f.db.raw.close();
  }
});

void test('an unlinked active subscription is available for review and does not create consent or a person', async () => {
  const f = await fixture();
  try {
    const scan = await claimBeehiivPoll(f.db, 'pub_unknown', f.now);
    assert.ok(typeof scan !== 'string');
    await saveBeehiivPollPage(f.db, scan, {
      rows: [
        { id: 'sub_unknown', status: 'active', created: Math.floor(f.now.getTime() / 1000) - 60 },
      ],
      nextCursor: null,
      now: f.now,
    });
    const result = await f.processNewsletterPollChoices(f.db, {
      publicationId: 'pub_unknown',
      policy: 'keep_unsubscribed',
      now: f.now,
    });
    assert.equal(result.processed, 0);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
    assert.equal(
      f.db.raw
        .prepare("SELECT state FROM newsletter_poll_choices WHERE publication_id='pub_unknown'")
        .get()?.state,
      'needs_review',
    );
  } finally {
    f.db.raw.close();
  }
});

void test('a failed transaction preserves the pending observation and original membership', async () => {
  const f = await fixture();
  try {
    await f.poll('inactive', f.now);
    f.db.raw.exec(
      "CREATE TRIGGER refuse_poll_withdrawal BEFORE INSERT ON consent_withdrawals BEGIN SELECT RAISE(ABORT,'fixture outage'); END",
    );
    await assert.rejects(
      f.processNewsletterPollChoices(f.db, {
        publicationId: 'pub_poll_fixture',
        policy: 'keep_unsubscribed',
        now: f.now,
      }),
      /fixture outage/,
    );
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'member');
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT state FROM newsletter_poll_choices WHERE publication_id='pub_poll_fixture'",
        )
        .get()?.state,
      'pending',
    );
  } finally {
    f.db.raw.close();
  }
});
