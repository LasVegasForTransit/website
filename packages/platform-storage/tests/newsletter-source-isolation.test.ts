import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { saveNewsletterEvent } from '../src/newsletter-inbound';
import { newsletterEmailKey } from '../src/newsletter-work';
import type { Db } from '../src/db';

const now = new Date('2026-10-14T12:00:00.000Z');

async function save(
  db: Db,
  name: string,
  publicationId: string,
  type: 'subscription.confirmed' | 'subscription.deleted',
) {
  const email = `${name}@example.invalid`;
  await saveNewsletterEvent(db, {
    publicationId,
    id: `evt_${name}`,
    messageId: `msg_${name}`,
    type,
    occurredAt: '2026-10-14T10:00:00.000Z',
    subscriptionId: `sub_${name}`,
    emailKey: await newsletterEmailKey(email),
    encryptedEmail: 'v1.fixture',
    now,
  });
  return email;
}

void test('source operation ownership and erasure stay isolated across people and publications', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  try {
    const alice = await people.applyNewsletterSourceEvent({
      publicationId: 'pub_alice',
      eventId: 'evt_alice',
      email: await save(db, 'alice', 'pub_alice', 'subscription.confirmed'),
      now,
    });
    const bob = await people.applyNewsletterSourceEvent({
      publicationId: 'pub_bob',
      eventId: 'evt_bob',
      email: await save(db, 'bob', 'pub_bob', 'subscription.confirmed'),
      now,
    });
    assert.ok(alice.personId && bob.personId);
    assert.deepEqual(
      db.raw
        .prepare('SELECT event_id,person_id FROM newsletter_source_operations ORDER BY event_id')
        .all()
        .map((row) => ({ ...row })),
      [
        { event_id: 'evt_alice', person_id: alice.personId },
        { event_id: 'evt_bob', person_id: bob.personId },
      ],
    );
    await people.deletePerson(bob.personId);
    assert.equal(
      db.raw
        .prepare('SELECT count(*) AS n FROM newsletter_address_tombstones WHERE email_key=?')
        .get(await newsletterEmailKey('alice@example.invalid'))?.n,
      0,
    );
    assert.equal((await people.getPerson(alice.personId))?.membership_status, 'member');
    assert.equal(
      db.raw
        .prepare("SELECT person_id FROM newsletter_source_operations WHERE event_id='evt_alice'")
        .get()?.person_id,
      alice.personId,
    );
  } finally {
    db.raw.close();
  }
});

void test('a concurrent duplicate consent cannot overwrite an applied provider withdrawal with stale membership', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  try {
    const consent = {
      scope: 'newsletter' as const,
      source: 'join_form' as const,
      method: 'checkbox' as const,
      wordingVersion: 'fixture',
      givenAt: '2026-10-14T09:00:00.000Z',
    };
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'raced@example.invalid' },
      consent,
    });
    await people.linkIdentity(person.id, {
      platform: 'beehiiv',
      externalId: 'sub_raced',
      externalEmail: 'raced@example.invalid',
      linkMethod: 'verified_email',
    });
    await save(db, 'raced', 'pub_race', 'subscription.deleted');
    let injected = false;
    const raced: Db = {
      prepare: (sql) => {
        const statement = db.prepare(sql);
        if (!/UPDATE people SET membership_status/i.test(sql)) return statement;
        const bind = statement.bind.bind(statement);
        statement.bind = (...values) => {
          const bound = bind(...values),
            run = bound.run.bind(bound);
          bound.run = async () => {
            if (!injected) {
              injected = true;
              assert.equal(
                (
                  await people.applyNewsletterSourceEvent({
                    publicationId: 'pub_race',
                    eventId: 'evt_raced',
                    email: 'raced@example.invalid',
                    now,
                  })
                ).kind,
                'applied',
              );
            }
            return run();
          };
          return bound;
        };
        return statement;
      },
      batch: (statements) => db.batch(statements),
    };
    await new PersonService(raced).recordConsent(person.id, consent);
    assert.equal(injected, true);
    assert.equal(
      db.raw
        .prepare(
          'SELECT count(*) AS n FROM consent_records WHERE person_id=? AND withdrawn_at IS NULL',
        )
        .get(person.id)?.n,
      0,
    );
    assert.equal((await people.getPerson(person.id))?.membership_status, 'former_member');
  } finally {
    db.raw.close();
  }
});
