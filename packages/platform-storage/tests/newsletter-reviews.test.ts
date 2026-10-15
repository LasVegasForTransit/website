import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { loadActor } from '../src/staff-roles';
import type { Db } from '../src/db';
import { claimBeehiivPoll, saveBeehiivPollPage } from '../src/beehiiv-poll-store';
import { newsletterEmailKey } from '../src/newsletter-work';

async function fixture() {
  const reviews = await import('../src/newsletter-reviews').catch(() => null);
  assert.ok(reviews, 'staff need an authorized way to resolve newsletter differences');
  const db = memoryDb();
  const people = new PersonService(db);
  const now = new Date(Date.now() - 1000);
  const member = async (name: string) =>
    (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { email: `${name}@example.invalid`, given_name: name },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
          givenAt: new Date(now.getTime() - 3600000).toISOString(),
        },
      })
    ).person;
  const admin = await member('admin');
  db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(admin.id, 'fixture', now.toISOString());
  const backup = await member('backup');
  db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(backup.id, 'fixture', now.toISOString());
  const person = await member('Rosa');
  await people.linkIdentity(person.id, {
    platform: 'beehiiv',
    externalId: 'sub_review',
    externalEmail: person.email ?? '',
    linkMethod: 'verified_email',
  });
  const scan = await claimBeehiivPoll(db, 'pub_review', now);
  assert.ok(typeof scan !== 'string');
  await saveBeehiivPollPage(db, scan, {
    rows: [
      { id: 'sub_review', status: 'inactive', created: Math.floor(now.getTime() / 1000) - 3600 },
    ],
    nextCursor: null,
    now,
  });
  db.raw.exec(
    "UPDATE newsletter_poll_choices SET state='needs_review',reason='choice_order_unknown'",
  );
  const actor = await loadActor(db, admin.id);
  assert.ok(actor);
  const ref = { kind: 'poll' as const, id: 'sub_review', revision: 1 };
  const version = (await reviews.newsletterReview(db, actor, 'pub_review', ref))?.version ?? '';
  return { ...reviews, db, people, person, actor, ref: { ...ref, version }, now };
}

void test('newsletter follow-up is scoped to the selected publication and fresh administrators', async () => {
  const f = await fixture();
  try {
    const page = await f.listNewsletterReviews(f.db, f.actor, 'pub_review', {});
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.name, 'Rosa');
    assert.equal((await f.listNewsletterReviews(f.db, f.actor, 'pub_other', {})).items.length, 0);
    assert.equal(
      (await f.newsletterReview(f.db, f.actor, 'pub_review', f.ref))?.personId,
      f.person.id,
    );
    f.db.raw.prepare('DELETE FROM staff_administrators WHERE person_id=?').run(f.actor.personId);
    await assert.rejects(f.listNewsletterReviews(f.db, f.actor, 'pub_review', {}), /access/);
    assert.equal(await f.newsletterReview(f.db, f.actor, 'pub_review', f.ref), null);
  } finally {
    f.db.raw.close();
  }
});

void test('accepting the mailing list status needs no invented confirmation and preserves the unknown choice date', async () => {
  const f = await fixture();
  try {
    const input = {
      ...f.ref,
      action: 'unsubscribe' as const,
      operationId: 'review-choice',
      note: '',
      now: f.now,
    };
    assert.equal((await f.resolveNewsletterReview(f.db, f.actor, 'pub_review', input)).kind, 'ok');
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'former_member');
    assert.deepEqual(
      {
        ...f.db.raw.prepare('SELECT source,withdrawn_at,time_basis FROM consent_withdrawals').get(),
      },
      { source: 'beehiiv_observed', withdrawn_at: f.now.toISOString(), time_basis: 'observed' },
    );
    assert.equal((await f.resolveNewsletterReview(f.db, f.actor, 'pub_review', input)).kind, 'ok');
    assert.equal(
      (
        await f.resolveNewsletterReview(f.db, f.actor, 'pub_review', {
          ...input,
          note: 'Other payload',
        })
      ).kind,
      'conflict',
    );
    assert.equal(
      f.db.raw.prepare("SELECT count(*) n FROM staff_audits WHERE action='newsletter.review'").get()
        ?.n,
      1,
    );
    assert.equal((await f.listNewsletterReviews(f.db, f.actor, 'pub_review', {})).items.length, 0);
  } finally {
    f.db.raw.close();
  }
});

void test('staff cannot reactivate from an old or unverified signup, while a newer verified choice clears a conflict', async () => {
  const f = await fixture();
  try {
    const input = {
      ...f.ref,
      action: 'recorded_choice' as const,
      operationId: 'use-choice',
      note: '',
      now: new Date(f.now.getTime() + 2000),
    };
    assert.equal(
      (await f.resolveNewsletterReview(f.db, f.actor, 'pub_review', input)).kind,
      'conflict',
    );
    await f.people.recordConsent(f.person.id, {
      scope: 'newsletter',
      source: 'account',
      method: 'checkbox',
      wordingVersion: 'fixture',
      renew: true,
      givenAt: new Date(f.now.getTime() + 500).toISOString(),
    });
    input.version = (await f.newsletterReview(f.db, f.actor, 'pub_review', f.ref))?.version ?? '';
    assert.equal(
      (await f.resolveNewsletterReview(f.db, f.actor, 'pub_review', input)).kind,
      'conflict',
    );
    f.db.raw
      .prepare('UPDATE people SET email_verified_at=? WHERE id=?')
      .run(input.now.toISOString(), f.person.id);
    input.version = (await f.newsletterReview(f.db, f.actor, 'pub_review', f.ref))?.version ?? '';
    assert.equal((await f.resolveNewsletterReview(f.db, f.actor, 'pub_review', input)).kind, 'ok');
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'member');
    assert.equal(
      f.db.raw.prepare('SELECT count(*) n FROM consent_records WHERE person_id=?').get(f.person.id)
        ?.n,
      2,
      'review creates no new permission',
    );
  } finally {
    f.db.raw.close();
  }
});

void test('unknown subscriptions can be inspected but a review cannot invent a member or permission', async () => {
  const f = await fixture();
  try {
    f.db.raw
      .prepare(
        "INSERT INTO beehiiv_subscription_observations(publication_id,subscription_id,status,subscription_created_at,observed_at,last_scan_started_at) VALUES('pub_review','sub_unknown','active',?,?,?)",
      )
      .run(f.now.toISOString(), f.now.toISOString(), f.now.toISOString());
    const ref = { kind: 'poll' as const, id: 'sub_unknown', revision: 1 };
    assert.equal((await f.newsletterReview(f.db, f.actor, 'pub_review', ref))?.personId, null);
    const version = (await f.newsletterReview(f.db, f.actor, 'pub_review', ref))?.version ?? '';
    assert.equal(
      (
        await f.resolveNewsletterReview(f.db, f.actor, 'pub_review', {
          ...ref,
          version,
          action: 'recorded_choice',
          operationId: 'unknown',
          note: '',
          now: f.now,
        })
      ).kind,
      'conflict',
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) n FROM people').get()?.n, 3);
  } finally {
    f.db.raw.close();
  }
});

void test('a revision change, revoked administrator or failed history write leaves every decision unapplied', async () => {
  for (const fault of ['revision', 'authorization', 'history'] as const) {
    const f = await fixture();
    try {
      let changed = false;
      const db: Db = {
        prepare: (sql) => f.db.prepare(sql),
        batch: async (statements) => {
          if (!changed) {
            changed = true;
            if (fault === 'revision')
              f.db.raw.exec('UPDATE newsletter_poll_choices SET revision=2');
            if (fault === 'authorization')
              f.db.raw
                .prepare('DELETE FROM staff_administrators WHERE person_id=?')
                .run(f.actor.personId);
            if (fault === 'history')
              f.db.raw.exec(
                "CREATE TRIGGER fail_newsletter_review BEFORE INSERT ON staff_audits BEGIN SELECT RAISE(ABORT,'fixture history outage'); END",
              );
          }
          return await f.db.batch(statements);
        },
      };
      const action = f.resolveNewsletterReview(db, f.actor, 'pub_review', {
        ...f.ref,
        action: 'unsubscribe',
        operationId: 'raced',
        note: 'Confirmed by phone.',
        now: f.now,
      });
      if (fault === 'history') await assert.rejects(action, /fixture history outage/);
      else assert.notEqual((await action).kind, 'ok');
      assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'member');
      assert.equal(
        f.db.raw.prepare("SELECT count(*) n FROM staff_operations WHERE operation_id='raced'").get()
          ?.n,
        0,
      );
    } finally {
      f.db.raw.close();
    }
  }
});

void test('a delayed signed unsubscribe cannot override a newer verified signup', async () => {
  const f = await fixture();
  try {
    const occurredAt = new Date(f.now.getTime() - 4 * 3600000).toISOString();
    f.db.raw
      .prepare('UPDATE people SET email_verified_at=? WHERE id=?')
      .run(f.now.toISOString(), f.person.id);
    f.db.raw
      .prepare(
        "INSERT INTO newsletter_inbound_events(publication_id,id,fingerprint,type,occurred_at,subscription_id,email_key,received_at,state) VALUES('pub_review','delayed','fixture','subscription.deleted',?,'sub_review',?,?,'needs_review')",
      )
      .run(occurredAt, await newsletterEmailKey(f.person.email ?? ''), f.now.toISOString());
    const ref = { kind: 'event' as const, id: 'delayed', revision: 1 };
    const item = await f.newsletterReview(f.db, f.actor, 'pub_review', ref);
    assert.ok(item);
    assert.equal(item.canUseRecordedChoice, true, 'receipt time cannot make an older choice newer');
    const input = {
      ...ref,
      version: item.version,
      operationId: 'delayed-review',
      note: '',
      now: f.now,
    };
    assert.equal(
      (
        await f.resolveNewsletterReview(f.db, f.actor, 'pub_review', {
          ...input,
          action: 'unsubscribe',
        })
      ).kind,
      'conflict',
    );
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'member');
    assert.equal(
      (
        await f.resolveNewsletterReview(f.db, f.actor, 'pub_review', {
          ...input,
          action: 'recorded_choice',
        })
      ).kind,
      'ok',
    );
  } finally {
    f.db.raw.close();
  }
});

void test('a signup within a whole-second source timestamp remains unresolved by either staff shortcut', async () => {
  const f = await fixture();
  try {
    const at = Math.floor(f.now.getTime() / 1000) * 1000 - 2000;
    f.db.raw
      .prepare('UPDATE consent_records SET given_at=? WHERE person_id=?')
      .run(new Date(at + 500).toISOString(), f.person.id);
    f.db.raw
      .prepare('UPDATE people SET email_verified_at=? WHERE id=?')
      .run(f.now.toISOString(), f.person.id);
    f.db.raw
      .prepare(
        "INSERT INTO newsletter_inbound_events(publication_id,id,fingerprint,type,occurred_at,subscription_id,email_key,received_at,state) VALUES('pub_review','imprecise','fixture','subscription.deleted',?,'sub_review',?,?,'needs_review')",
      )
      .run(
        new Date(at).toISOString(),
        await newsletterEmailKey(f.person.email ?? ''),
        f.now.toISOString(),
      );
    const ref = { kind: 'event' as const, id: 'imprecise', revision: 1 };
    const item = await f.newsletterReview(f.db, f.actor, 'pub_review', ref);
    assert.ok(item);
    assert.equal(item.canUseRecordedChoice, false);
    for (const action of ['unsubscribe', 'recorded_choice'] as const)
      assert.equal(
        (
          await f.resolveNewsletterReview(f.db, f.actor, 'pub_review', {
            ...ref,
            version: item.version,
            operationId: action,
            note: '',
            now: f.now,
            action,
          })
        ).kind,
        'conflict',
      );
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'member');
  } finally {
    f.db.raw.close();
  }
});

void test('reviewing a known signed withdrawal preserves its original choice time', async () => {
  const f = await fixture();
  try {
    const occurredAt = new Date(f.now.getTime() - 30 * 60000).toISOString();
    f.db.raw
      .prepare(
        "INSERT INTO newsletter_inbound_events(publication_id,id,fingerprint,type,occurred_at,subscription_id,email_key,received_at,state) VALUES('pub_review','known','fixture','subscription.deleted',?,'sub_review',?,?,'needs_review')",
      )
      .run(occurredAt, await newsletterEmailKey(f.person.email ?? ''), f.now.toISOString());
    const ref = { kind: 'event' as const, id: 'known', revision: 1 };
    const item = await f.newsletterReview(f.db, f.actor, 'pub_review', ref);
    assert.ok(item);
    assert.equal(
      (
        await f.resolveNewsletterReview(f.db, f.actor, 'pub_review', {
          ...ref,
          version: item.version,
          operationId: 'known-choice',
          note: '',
          now: f.now,
          action: 'unsubscribe',
        })
      ).kind,
      'ok',
    );
    assert.deepEqual(
      {
        ...f.db.raw
          .prepare(
            'SELECT source,withdrawn_at,time_basis,source_occurred_at FROM consent_withdrawals',
          )
          .get(),
      },
      {
        source: 'beehiiv',
        withdrawn_at: occurredAt,
        time_basis: 'choice',
        source_occurred_at: occurredAt,
      },
    );
  } finally {
    f.db.raw.close();
  }
});
