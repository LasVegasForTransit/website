import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, everyStoredText } from './support/db';
import { PersonService } from '../src/person-service';
import { loadNewsletterPlan, newsletterPlanIsCurrent } from '../src/newsletter-plan';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { claimNewsletterJob, releaseNewsletterLease } from '../src/newsletter-sync-store';

async function receiver() {
  const module = await import('../src/newsletter-inbound').catch(() => null);
  assert.ok(module, 'authenticated newsletter choices need durable replay protection');
  return module;
}
const now = new Date('2026-10-14T12:00:00.000Z');
async function input() {
  return {
    publicationId: 'pub_fixture',
    id: 'evt_fixture',
    messageId: 'msg_fixture',
    type: 'subscription.deleted' as const,
    occurredAt: '2026-10-13T12:00:00.000Z',
    subscriptionId: 'sub_fixture',
    emailKey: `email:${await digestToken('member@example.invalid')}`,
    encryptedEmail: 'v1.encrypted.fixture',
    now,
  };
}
void test('stores original source evidence once across repeated and redelivered messages', async () => {
  const db = memoryDb();
  try {
    const { saveNewsletterEvent } = await receiver();
    const event = await input();
    assert.equal(await saveNewsletterEvent(db, event), 'accepted');
    assert.equal(await saveNewsletterEvent(db, event), 'accepted');
    assert.equal(
      await saveNewsletterEvent(db, {
        ...event,
        messageId: 'msg_redelivered',
        encryptedEmail: 'v1.new.iv',
      }),
      'accepted',
    );
    const rows = db.raw.prepare('SELECT * FROM newsletter_inbound_events').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.occurred_at, event.occurredAt);
    assert.equal(rows[0].encrypted_email, event.encryptedEmail);
    assert.equal(rows[0].state, 'pending');
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM newsletter_inbound_deliveries').get()?.n,
      2,
    );
    assert.ok(!everyStoredText(db).includes('member@example.invalid'));
  } finally {
    db.raw.close();
  }
});
void test('rejects source and delivery identifier reuse with different evidence atomically', async () => {
  const db = memoryDb();
  try {
    const { saveNewsletterEvent } = await receiver();
    const event = await input();
    await saveNewsletterEvent(db, event);
    for (const change of [
      { occurredAt: '2026-10-14T11:00:00.000Z' },
      { type: 'subscription.confirmed' as const },
      { subscriptionId: 'sub_someone_else' },
      { emailKey: `email:${await digestToken('other@example.invalid')}` },
      { id: 'evt_other' },
    ])
      assert.equal(await saveNewsletterEvent(db, { ...event, ...change }), 'conflict');
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM newsletter_inbound_events').get()?.n, 1);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM newsletter_inbound_deliveries').get()?.n,
      1,
    );
  } finally {
    db.raw.close();
  }
});
void test('pending incoming choices fence current-address and retained-account work without affecting others', async () => {
  const db = memoryDb();
  try {
    const { saveNewsletterEvent } = await receiver();
    const people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'member@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    const before = await loadNewsletterPlan(db, person.id);
    assert.ok(before);
    assert.equal(await newsletterPlanIsCurrent(db, before), true);
    await saveNewsletterEvent(db, await input());
    assert.equal(await newsletterPlanIsCurrent(db, before), false);
    const pending = await loadNewsletterPlan(db, person.id);
    assert.ok(pending);
    assert.equal(await newsletterPlanIsCurrent(db, pending), false);
    const { person: other } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'unrelated@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    const unrelated = await loadNewsletterPlan(db, other.id);
    assert.ok(unrelated);
    assert.equal(await newsletterPlanIsCurrent(db, unrelated), true);
    await people.linkIdentity(other.id, {
      platform: 'beehiiv',
      externalId: 'sub_fixture',
      externalEmail: 'old@example.invalid',
      linkMethod: 'staff_confirmed',
    });
    const retained = await loadNewsletterPlan(db, other.id);
    assert.ok(retained);
    assert.equal(await newsletterPlanIsCurrent(db, retained), false);
    await people.deletePerson(other.id);
    const erased = await loadNewsletterPlan(db, other.id);
    assert.ok(erased);
    assert.equal(erased.desired, 'inactive');
    assert.equal(await newsletterPlanIsCurrent(db, erased), true);
  } finally {
    db.raw.close();
  }
});
void test('pending choices defer only their held account job so unrelated work can continue', async () => {
  const db = memoryDb();
  try {
    const { saveNewsletterEvent } = await receiver();
    const people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'member@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    const time = new Date(Date.now() + 1000),
      lease = await claimNewsletterJob(db, person.id, 'pub_fixture', time);
    const plan = await loadNewsletterPlan(db, person.id);
    assert.ok(lease && plan);
    await saveNewsletterEvent(db, await input());
    const module = await import('../src/newsletter-plan');
    assert.equal(
      typeof module.deferPendingNewsletterChoice,
      'function',
      'pending source evidence needs account-scoped dispatch deferral',
    );
    assert.equal(await module.deferPendingNewsletterChoice(db, plan, lease.token, time), true);
    assert.equal(
      db.raw
        .prepare('SELECT next_attempt_at FROM newsletter_sync_jobs WHERE person_id=?')
        .get(person.id)?.next_attempt_at,
      new Date(time.getTime() + 60_000).toISOString(),
    );
    await releaseNewsletterLease(db, lease);
    assert.equal(await module.deferPendingNewsletterChoice(db, plan, lease.token, time), false);
  } finally {
    db.raw.close();
  }
});
