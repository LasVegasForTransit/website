import assert from 'node:assert/strict';
import test from 'node:test';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { memoryDb, type MemoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { saveNewsletterEvent } from '../src/newsletter-inbound';
import type { Db } from '../src/db';
import { runMaintenance } from '../src/retention';
import { mergeFixture } from './support/merge-fixture';

const email = 'erase-newsletter@example.invalid';
const publicationId = 'pub_erasure_fixture';
const subscriptionId = 'sub_erasure_fixture';

async function fixture(linked = true) {
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
      givenAt: '2026-01-01T12:00:00.000Z',
    },
  });
  if (linked)
    await people.linkIdentity(person.id, {
      platform: 'beehiiv',
      externalId: subscriptionId,
      externalEmail: email,
      linkMethod: 'verified_email',
    });
  return { db, people, person };
}

async function save(
  db: MemoryDb,
  id: string,
  options: {
    address?: string;
    subscription?: string;
    type?: 'subscription.created' | 'subscription.confirmed' | 'subscription.deleted';
    at?: string;
  } = {},
) {
  assert.equal(
    await saveNewsletterEvent(db, {
      publicationId,
      id,
      messageId: `message_${id}`,
      type: options.type ?? 'subscription.confirmed',
      occurredAt: options.at ?? '2026-01-02T12:00:00.000Z',
      subscriptionId: options.subscription ?? subscriptionId,
      emailKey: `email:${await digestToken(options.address ?? email)}`,
      encryptedEmail: `private-address-${id}`,
      now: new Date(),
    }),
    'accepted',
  );
}

function inbox(db: MemoryDb, id: string) {
  return db.raw
    .prepare('SELECT state,encrypted_email FROM newsletter_inbound_events WHERE id=?')
    .get(id);
}

void test('member deletion clears pending and review addresses while preserving unrelated queued work', async () => {
  const f = await fixture();
  try {
    await save(f.db, 'known');
    await save(f.db, 'unlinked', { subscription: 'sub_not_linked_yet' });
    await save(f.db, 'review', { type: 'subscription.created' });
    await f.people.applyNewsletterSourceEvent({
      publicationId,
      eventId: 'review',
      email,
      now: new Date(),
    });
    assert.equal(inbox(f.db, 'review')?.state, 'needs_review');
    await save(f.db, 'unrelated', {
      address: 'other-member@example.invalid',
      subscription: 'sub_unrelated',
    });

    await f.people.deletePerson(f.person.id);

    for (const id of ['known', 'unlinked', 'review'])
      assert.deepEqual({ ...inbox(f.db, id) }, { state: 'ignored', encrypted_email: null }, id);
    assert.deepEqual(
      { ...inbox(f.db, 'unrelated') },
      { state: 'pending', encrypted_email: 'private-address-unrelated' },
    );
  } finally {
    f.db.raw.close();
  }
});

void test('a late unlinked confirmation cannot recreate a deleted member or retain their address', async () => {
  const f = await fixture(false);
  try {
    await f.people.deletePerson(f.person.id);
    await save(f.db, 'late_unlinked');
    await f.people.applyNewsletterSourceEvent({
      publicationId,
      eventId: 'late_unlinked',
      email,
      now: new Date(),
    });
    assert.deepEqual(
      { ...inbox(f.db, 'late_unlinked') },
      { state: 'ignored', encrypted_email: null },
    );
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM people WHERE deleted_at IS NULL').get()?.n,
      0,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('a new confirmation after erasure requires review instead of automatically creating membership', async () => {
  const f = await fixture(false);
  try {
    await f.people.deletePerson(f.person.id);
    const at = new Date(Date.now() + 1000).toISOString();
    await save(f.db, 'new_after_erasure', { at });
    const result = await f.people.applyNewsletterSourceEvent({
      publicationId,
      eventId: 'new_after_erasure',
      email,
      now: new Date(Date.parse(at) + 1000),
    });
    assert.equal(result.kind, 'needs_review');
    assert.equal(inbox(f.db, 'new_after_erasure')?.state, 'needs_review');
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM people WHERE deleted_at IS NULL').get()?.n,
      0,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('an email change rolls back stale erasure work and retries with the current address', async () => {
  const f = await fixture(false);
  try {
    const changed = 'new-before-erasure@example.invalid';
    await save(f.db, 'new_address', { address: changed });
    let raced = false;
    let refused = false;
    const wrapped: Db = {
      prepare: (sql) => f.db.prepare(sql),
      batch: async (statements) => {
        if (!raced) {
          raced = true;
          await f.people.updateFields(f.person.id, {
            source: 'member',
            fields: { email: changed },
          });
        }
        try {
          return await f.db.batch(statements);
        } catch (error) {
          refused = true;
          assert.equal((await f.people.getPerson(f.person.id))?.email, changed);
          assert.equal(inbox(f.db, 'new_address')?.state, 'pending');
          throw error;
        }
      },
    };
    await new PersonService(wrapped).deletePerson(f.person.id);
    assert.equal(refused, true);
    assert.equal(await f.people.getPerson(f.person.id), null);
    assert.deepEqual(
      { ...inbox(f.db, 'new_address') },
      { state: 'ignored', encrypted_email: null },
    );
  } finally {
    f.db.raw.close();
  }
});

void test('two deletions in the same millisecond cannot consume another address’s new review candidate', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-01T12:00:00.000Z') });
  const f = await fixture(false);
  try {
    await f.people.deletePerson(f.person.id);
    await save(f.db, 'first_new_choice', { at: '2030-01-01T12:00:01.000Z' });
    const { person: other } = await f.people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'other-erasure@example.invalid' },
    });
    await f.people.deletePerson(other.id);
    assert.deepEqual(
      { ...inbox(f.db, 'first_new_choice') },
      { state: 'pending', encrypted_email: 'private-address-first_new_choice' },
    );
  } finally {
    f.db.raw.close();
  }
});

void test('retention erases queued addresses from legacy deletions before purging the profile', async () => {
  const f = await fixture(false);
  try {
    await save(f.db, 'legacy_pending');
    f.db.raw
      .prepare("UPDATE people SET deleted_at='2020-01-01T12:00:00.000Z' WHERE id=?")
      .run(f.person.id);
    await runMaintenance(f.db, { now: new Date('2030-01-01T12:00:00.000Z'), category: 'profiles' });
    assert.equal(f.db.raw.prepare('SELECT id FROM people WHERE id=?').get(f.person.id), undefined);
    assert.deepEqual(
      { ...inbox(f.db, 'legacy_pending') },
      { state: 'ignored', encrypted_email: null },
    );
    await save(f.db, 'after_legacy_purge');
    assert.deepEqual(
      { ...inbox(f.db, 'after_legacy_purge') },
      { state: 'ignored', encrypted_email: null },
    );
  } finally {
    f.db.raw.close();
  }
});

void test('a fresh verified signup can reuse an erased address and still honor a later unsubscribe', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-01T12:00:00.000Z') });
  const f = await fixture(false);
  try {
    await f.people.deletePerson(f.person.id);
    t.mock.timers.tick(1000);
    const { person } = await f.people.upsertFromSource({
      source: 'join_form',
      fields: { email },
      emailVerified: true,
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    assert.notEqual(person.id, f.person.id);
    t.mock.timers.tick(1000);
    await save(f.db, 'fresh_confirmed', { at: new Date().toISOString() });
    const confirmed = await f.people.applyNewsletterSourceEvent({
      publicationId,
      eventId: 'fresh_confirmed',
      email,
      now: new Date(),
    });
    assert.equal(confirmed.kind, 'applied');
    assert.equal(confirmed.personId, person.id);
    t.mock.timers.tick(1000);
    await save(f.db, 'fresh_left', { type: 'subscription.deleted', at: new Date().toISOString() });
    assert.equal(
      (
        await f.people.applyNewsletterSourceEvent({
          publicationId,
          eventId: 'fresh_left',
          email,
          now: new Date(),
        })
      ).kind,
      'applied',
    );
    assert.equal((await f.people.getPerson(person.id))?.membership_status, 'former_member');
    assert.equal(await f.people.getPerson(f.person.id), null);
  } finally {
    f.db.raw.close();
  }
});

void test('a merged account’s alternate address is erased without affecting a separate member', async () => {
  const f = await mergeFixture();
  const alias = 'merged-newsletter@example.invalid';
  try {
    await f.people.linkIdentity(f.merged.id, {
      platform: 'beehiiv',
      externalId: subscriptionId,
      externalEmail: alias,
      linkMethod: 'self_linked',
    });
    assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
    await save(f.db, 'merged_alias', { address: alias, subscription: 'sub_alias_unlinked' });
    await f.people.deletePerson(f.survivor.id);
    assert.deepEqual(
      { ...inbox(f.db, 'merged_alias') },
      { state: 'ignored', encrypted_email: null },
    );
    await save(f.db, 'late_alias', { address: alias, subscription: 'sub_alias_late' });
    assert.deepEqual({ ...inbox(f.db, 'late_alias') }, { state: 'ignored', encrypted_email: null });
    assert.equal((await f.people.getPerson(f.admin.id))?.given_name, 'Administrator');
  } finally {
    f.db.raw.close();
  }
});

void test('a late erasure failure restores newsletter addresses and leaves no suppression or temporary scope', async () => {
  const f = await fixture();
  try {
    await save(f.db, 'rollback_address');
    f.db.raw.exec(
      "CREATE TRIGGER fail_newsletter_erasure BEFORE DELETE ON person_erasure_scope BEGIN SELECT RAISE(ABORT,'fixture erasure rollback'); END;",
    );
    await assert.rejects(f.people.deletePerson(f.person.id), /fixture erasure rollback/);
    assert.equal((await f.people.getPerson(f.person.id))?.email, email);
    assert.deepEqual(
      { ...inbox(f.db, 'rollback_address') },
      { state: 'pending', encrypted_email: 'private-address-rollback_address' },
    );
    for (const table of [
      'newsletter_address_tombstones',
      'newsletter_erasure_checks',
      'person_erasure_scope',
    ])
      assert.equal(f.db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});
