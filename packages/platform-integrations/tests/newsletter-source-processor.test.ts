import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, type MemoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { saveNewsletterEvent } from '@lasvegasfortransit/platform-storage/newsletter-inbound';
import { newsletterEmailKey } from '@lasvegasfortransit/platform-storage/newsletter-work';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import { NewsletterEventCipher } from '../src/newsletter-event-cipher';

const publicationId = 'pub_processor_fixture';
const intentKey = 'a'.repeat(43);
const now = new Date('2026-10-14T12:00:00.000Z');
const email = 'processed-member@example.invalid';

async function processor() {
  const module = await import('../src/newsletter-source-processor').catch(() => null);
  assert.ok(module, 'saved newsletter events need bounded canonical processing');
  return module.processNewsletterSourceEvents;
}

async function save(
  db: MemoryDb,
  id: string,
  options: {
    address?: string;
    publication?: string;
    subscription?: string;
    type?: 'subscription.deleted' | 'subscription.confirmed';
    at?: string;
    damaged?: boolean;
    encryptedAddress?: string;
  } = {},
) {
  const address = options.address ?? email;
  const context = {
    id,
    publicationId: options.publication ?? publicationId,
    subscriptionId: options.subscription ?? 'sub_processor_fixture',
    emailKey: await newsletterEmailKey(address),
  };
  const encryptedEmail = options.damaged
    ? 'v1.damaged.cipher'
    : await new NewsletterEventCipher(intentKey).encrypt(
        options.encryptedAddress ?? address,
        context,
      );
  await saveNewsletterEvent(db, {
    ...context,
    messageId: `message_${id}`,
    type: options.type ?? 'subscription.deleted',
    occurredAt: options.at ?? '2026-10-14T10:00:00.000Z',
    encryptedEmail,
    now,
  });
}

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
    externalId: 'sub_processor_fixture',
    externalEmail: email,
    linkMethod: 'verified_email',
  });
  return { db, people, person };
}

void test('processing a durable encrypted withdrawal changes membership once at the original choice time', async () => {
  const run = await processor();
  const f = await fixture();
  try {
    await save(f.db, 'choice_once');
    const budget = queryBudget(f.db, 50);
    const result = await run(budget.db, { publicationId, intentKey, now });
    assert.equal(result.processed, 1);
    assert.equal(result.applied, 1);
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'former_member');
    assert.equal(
      f.db.raw.prepare('SELECT withdrawn_at FROM consent_records').get()?.withdrawn_at,
      '2026-10-14T10:00:00.000Z',
    );
    assert.equal(
      f.db.raw.prepare('SELECT encrypted_email FROM newsletter_inbound_events').get()
        ?.encrypted_email,
      null,
    );
    assert.equal(JSON.stringify(result).includes(email), false);
    const repeated = await run(queryBudget(f.db, 50).db, { publicationId, intentKey, now });
    assert.equal(repeated.kind, 'idle');
    assert.equal(repeated.processed, 0);
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

void test('unreadable addresses require review while future choices and other publications cannot starve ready work', async () => {
  const run = await processor();
  const f = await fixture();
  try {
    await save(f.db, 'future_first', {
      address: 'future@example.invalid',
      subscription: 'sub_future',
      at: '2026-10-14T12:00:10.000Z',
      type: 'subscription.confirmed',
    });
    await save(f.db, 'damaged', {
      address: 'damaged@example.invalid',
      subscription: 'sub_damaged',
      damaged: true,
    });
    await save(f.db, 'other_publication', { publication: 'pub_other' });
    await save(f.db, 'ready_withdrawal', { at: '2026-10-14T11:00:00.000Z' });
    const result = await run(queryBudget(f.db, 50).db, { publicationId, intentKey, now });
    assert.equal(result.processed, 2);
    assert.equal(result.review, 1);
    assert.equal(result.applied, 1);
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'former_member');
    for (const id of ['future_first', 'other_publication'])
      assert.equal(
        f.db.raw.prepare('SELECT state FROM newsletter_inbound_events WHERE id=?').get(id)?.state,
        'pending',
      );
    assert.equal(
      f.db.raw
        .prepare("SELECT reason FROM newsletter_source_operations WHERE event_id='damaged'")
        .get()?.reason,
      'address_unreadable',
    );
  } finally {
    f.db.raw.close();
  }
});

void test('three newly confirmed members fit one invocation and the remaining queue resumes without duplicates', async () => {
  const run = await processor();
  const db = memoryDb();
  try {
    for (let i = 0; i < 4; i++)
      await save(db, `new_${i}`, {
        address: `new-${i}@example.invalid`,
        subscription: `sub_new_${i}`,
        type: 'subscription.confirmed',
      });
    const budget = queryBudget(db, 50);
    const first = await run(budget.db, { publicationId, intentKey, now, limit: 999 });
    assert.equal(first.processed, 3);
    assert.equal(first.applied, 3);
    assert.ok(budget.queries <= 50);
    assert.ok(budget.largestBindings <= 100);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM people WHERE deleted_at IS NULL').get()?.n,
      3,
    );
    const resumed = await run(queryBudget(db, 50).db, { publicationId, intentKey, now });
    assert.equal(resumed.processed, 1);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM people WHERE deleted_at IS NULL').get()?.n,
      4,
    );
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM newsletter_source_operations').get()?.n,
      4,
    );
  } finally {
    db.raw.close();
  }
});

void test('a valid cipher with the wrong address requires review instead of repeatedly blocking the queue', async () => {
  const run = await processor();
  const db = memoryDb();
  try {
    await save(db, 'mismatched_address', {
      type: 'subscription.confirmed',
      encryptedAddress: 'another-inbox@example.invalid',
    });
    const result = await run(queryBudget(db, 50).db, { publicationId, intentKey, now });
    assert.equal(result.review, 1);
    assert.equal(
      db.raw.prepare('SELECT state FROM newsletter_inbound_events').get()?.state,
      'needs_review',
    );
    assert.equal(
      db.raw.prepare('SELECT reason FROM newsletter_source_operations').get()?.reason,
      'address_conflict',
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});

void test('a storage failure stays pending for retry and cannot be relabeled as an unreadable address', async () => {
  const run = await processor();
  const f = await fixture();
  try {
    await save(f.db, 'retry_storage');
    f.db.raw.exec(
      "CREATE TRIGGER reject_processor_outcome BEFORE UPDATE OF state ON newsletter_inbound_events WHEN NEW.state='applied' BEGIN SELECT RAISE(ABORT,'fixture processor failure'); END;",
    );
    await assert.rejects(
      run(queryBudget(f.db, 50).db, { publicationId, intentKey, now }),
      /fixture processor failure/,
    );
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'member');
    assert.equal(
      f.db.raw.prepare('SELECT state FROM newsletter_inbound_events').get()?.state,
      'pending',
    );
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM newsletter_source_operations').get()?.n,
      0,
    );
    f.db.raw.exec('DROP TRIGGER reject_processor_outcome');
    assert.equal(
      (await run(queryBudget(f.db, 50).db, { publicationId, intentKey, now })).applied,
      1,
    );
  } finally {
    f.db.raw.close();
  }
});
