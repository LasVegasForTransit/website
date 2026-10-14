import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { saveNewsletterEvent } from '../src/newsletter-inbound';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from '../src/db';

const now = new Date('2026-10-14T12:00:00.000Z');
const email = 'source-member@example.invalid';
const publicationId = 'pub_source_fixture';
const subscriptionId = 'sub_source_fixture';

async function fixture() {
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email },
    emailVerified: true,
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: '2026-10-14T09:00:00.000Z',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'beehiiv',
    externalId: subscriptionId,
    externalEmail: email,
    linkMethod: 'verified_email',
  });
  return { db, people, person };
}

async function save(
  db: ReturnType<typeof memoryDb>,
  id: string,
  type: 'subscription.deleted' | 'subscription.confirmed' | 'subscription.created',
  occurredAt: string,
) {
  const address = email;
  assert.equal(
    await saveNewsletterEvent(db, {
      publicationId,
      id,
      messageId: `message_${id}`,
      type,
      occurredAt,
      subscriptionId,
      emailKey: `email:${await digestToken(address)}`,
      encryptedEmail: 'v1.private.fixture',
      now,
    }),
    'accepted',
  );
}

async function apply(people: PersonService, eventId: string, address = email) {
  return await people.applyNewsletterSourceEvent({ publicationId, eventId, email: address, now });
}

void test('a saved provider withdrawal changes canonical membership at its original source time once', async () => {
  const f = await fixture();
  try {
    const at = '2026-10-14T10:00:00.000Z';
    await save(f.db, 'evt_withdrawal', 'subscription.deleted', at);
    assert.equal((await apply(f.people, 'evt_withdrawal')).kind, 'applied');
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'former_member');
    assert.equal(
      f.db.raw
        .prepare('SELECT withdrawn_at FROM consent_records WHERE person_id=?')
        .get(f.person.id)?.withdrawn_at,
      at,
    );
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT occurred_at FROM engagement_events WHERE person_id=? AND type='unsubscribed'",
        )
        .get(f.person.id)?.occurred_at,
      at,
    );
    assert.equal((await apply(f.people, 'evt_withdrawal')).kind, 'already_processed');
    assert.equal(
      f.db.raw
        .prepare("SELECT count(*) AS n FROM engagement_events WHERE type='unsubscribed'")
        .get()?.n,
      1,
    );
    assert.equal(
      f.db.raw.prepare('SELECT state,encrypted_email FROM newsletter_inbound_events').get()
        ?.encrypted_email,
      null,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('a later confirmed choice rejoins without using the original subscription creation date', async () => {
  const f = await fixture();
  try {
    await save(f.db, 'evt_left', 'subscription.deleted', '2026-10-14T10:00:00.000Z');
    await apply(f.people, 'evt_left');
    await save(f.db, 'evt_rejoined', 'subscription.confirmed', '2026-10-14T11:00:00.000Z');
    assert.equal((await apply(f.people, 'evt_rejoined')).kind, 'applied');
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'member');
    const consent = f.db.raw
      .prepare(
        'SELECT given_at,source,method FROM consent_records WHERE person_id=? AND withdrawn_at IS NULL',
      )
      .get(f.person.id);
    assert.deepEqual(
      { ...consent },
      { given_at: '2026-10-14T11:00:00.000Z', source: 'beehiiv', method: 'double_opt_in' },
    );
  } finally {
    f.db.raw.close();
  }
});

for (const reversed of [false, true]) {
  void test(`withdrawal wins a same-time source tie, reversed delivery: ${reversed}`, async () => {
    const f = await fixture();
    try {
      const events = [
        ['evt_tie_active', 'subscription.confirmed'],
        ['evt_tie_inactive', 'subscription.deleted'],
      ] as const;
      for (const [id, type] of reversed ? [...events].reverse() : events) {
        await save(f.db, id, type, '2026-10-14T10:00:00.000Z');
        await apply(f.people, id);
      }
      assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'former_member');
    } finally {
      f.db.raw.close();
    }
  });
}

void test('an older delayed withdrawal preserves a newer platform consent', async () => {
  const f = await fixture();
  try {
    await f.people.withdrawConsent(f.person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: '2026-10-14T10:00:00.000Z',
    });
    await f.people.recordConsent(f.person.id, {
      scope: 'newsletter',
      source: 'account',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: '2026-10-14T11:00:00.000Z',
    });
    await save(f.db, 'evt_old_withdrawal', 'subscription.deleted', '2026-10-14T10:30:00.000Z');
    await apply(f.people, 'evt_old_withdrawal');
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'member');
    assert.equal(
      f.db.raw
        .prepare(
          'SELECT count(*) AS n FROM consent_records WHERE person_id=? AND withdrawn_at IS NULL',
        )
        .get(f.person.id)?.n,
      1,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('a newer withdrawal fences an older delayed confirmation', async () => {
  const f = await fixture();
  try {
    await f.people.withdrawConsent(f.person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: '2026-10-14T11:00:00.000Z',
    });
    await save(f.db, 'evt_old_confirmation', 'subscription.confirmed', '2026-10-14T10:30:00.000Z');
    assert.equal((await apply(f.people, 'evt_old_confirmation')).kind, 'ignored');
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'former_member');
  } finally {
    f.db.raw.close();
  }
});

void test('an arbitrary creation event remains reviewable without inventing affirmative consent', async () => {
  const f = await fixture();
  try {
    await f.people.withdrawConsent(f.person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: '2026-10-14T10:00:00.000Z',
    });
    await save(f.db, 'evt_created', 'subscription.created', '2026-10-14T11:00:00.000Z');
    assert.equal((await apply(f.people, 'evt_created')).kind, 'needs_review');
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'former_member');
    assert.equal(
      f.db.raw.prepare('SELECT state FROM newsletter_inbound_events').get()?.state,
      'needs_review',
    );
  } finally {
    f.db.raw.close();
  }
});

void test('a new independently confirmed subscription creates one canonical person and linked membership', async () => {
  const db = memoryDb(),
    people = new PersonService(db);
  try {
    await save(db, 'evt_new_confirmed', 'subscription.confirmed', '2026-10-14T11:00:00.000Z');
    const result = await apply(people, 'evt_new_confirmed');
    assert.equal(result.kind, 'applied');
    assert.ok(result.personId);
    assert.match(result.personId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.equal((await people.getPerson(result.personId))?.membership_status, 'member');
    assert.equal(
      db.raw.prepare('SELECT external_id FROM identities WHERE person_id=?').get(result.personId)
        ?.external_id,
      subscriptionId,
    );
    await apply(people, 'evt_new_confirmed');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
  } finally {
    db.raw.close();
  }
});

void test('verified source confirmation uses the existing matching person without creating a duplicate', async () => {
  const db = memoryDb(),
    people = new PersonService(db);
  try {
    const { person } = await people.upsertFromSource({ source: 'join_form', fields: { email } });
    await save(db, 'evt_match_confirmed', 'subscription.confirmed', '2026-10-14T11:00:00.000Z');
    const result = await apply(people, 'evt_match_confirmed');
    assert.equal(result.kind, 'applied');
    assert.equal(result.personId, person.id);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
    assert.equal((await people.getPerson(person.id))?.membership_status, 'member');
  } finally {
    db.raw.close();
  }
});

void test('an unlinked withdrawal prevents an older delayed confirmation from creating a member', async () => {
  const db = memoryDb(),
    people = new PersonService(db);
  try {
    await save(db, 'evt_unlinked_left', 'subscription.deleted', '2026-10-14T11:00:00.000Z');
    await apply(people, 'evt_unlinked_left');
    await save(
      db,
      'evt_unlinked_old_confirm',
      'subscription.confirmed',
      '2026-10-14T10:00:00.000Z',
    );
    assert.equal((await apply(people, 'evt_unlinked_old_confirm')).kind, 'ignored');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});

void test('a late source choice cannot revive an erased linked person', async () => {
  const f = await fixture();
  try {
    await f.people.deletePerson(f.person.id);
    await save(f.db, 'evt_after_erasure', 'subscription.confirmed', '2026-10-14T11:00:00.000Z');
    assert.deepEqual(
      { ...f.db.raw.prepare('SELECT state,encrypted_email FROM newsletter_inbound_events').get() },
      { state: 'ignored', encrypted_email: null },
    );
    assert.equal((await apply(f.people, 'evt_after_erasure')).kind, 'already_processed');
    assert.equal(await f.people.getPerson(f.person.id), null);
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM people WHERE deleted_at IS NULL').get()?.n,
      0,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('a withdrawal arriving after planning fences the entire source transaction', async () => {
  const f = await fixture();
  try {
    await save(f.db, 'evt_racing_confirm', 'subscription.confirmed', '2026-10-14T10:00:00.000Z');
    const wrapped: Db = {
      prepare: (sql) => f.db.prepare(sql),
      batch: async (statements) => {
        await f.people.withdrawConsent(f.person.id, {
          scope: 'newsletter',
          source: 'account',
          withdrawnAt: '2026-10-14T11:00:00.000Z',
        });
        return await f.db.batch(statements);
      },
    };
    assert.equal((await apply(new PersonService(wrapped), 'evt_racing_confirm')).kind, 'stale');
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'former_member');
    assert.equal(
      f.db.raw.prepare('SELECT state FROM newsletter_inbound_events').get()?.state,
      'pending',
    );
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM newsletter_source_operations').get()?.n,
      0,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('failure recording the inbox outcome rolls back consent, membership and source evidence', async () => {
  const f = await fixture();
  try {
    await save(f.db, 'evt_rollback', 'subscription.deleted', '2026-10-14T10:00:00.000Z');
    f.db.raw.exec(
      "CREATE TRIGGER reject_source_outcome BEFORE UPDATE OF state ON newsletter_inbound_events WHEN NEW.state='applied' BEGIN SELECT RAISE(ABORT,'fixture source failure'); END;",
    );
    await assert.rejects(() => apply(f.people, 'evt_rollback'), /fixture source failure/);
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'member');
    assert.equal(
      f.db.raw.prepare('SELECT withdrawn_at FROM consent_records').get()?.withdrawn_at,
      null,
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM consent_withdrawals').get()?.n, 0);
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM newsletter_source_operations').get()?.n,
      0,
    );
    assert.equal(
      f.db.raw.prepare('SELECT state FROM newsletter_inbound_events').get()?.state,
      'pending',
    );
  } finally {
    f.db.raw.close();
  }
});

void test('authenticated source clock skew waits until the choice time instead of creating future consent', async () => {
  const db = memoryDb(),
    people = new PersonService(db);
  try {
    await save(db, 'evt_future_choice', 'subscription.confirmed', '2026-10-14T12:00:05.000Z');
    assert.equal((await apply(people, 'evt_future_choice')).kind, 'stale');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
    assert.equal(
      db.raw.prepare('SELECT state FROM newsletter_inbound_events').get()?.state,
      'pending',
    );
  } finally {
    db.raw.close();
  }
});
