import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './support/beehiiv-sync-fixture';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { saveNewsletterEvent } from '@lasvegasfortransit/platform-storage/newsletter-inbound';
import { reconcileBeehiivPerson } from '../src/beehiiv-sync';
import { NewsletterEventCipher } from '../src/newsletter-event-cipher';
import { processNewsletterSourceEvents } from '../src/newsletter-source-processor';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';

async function saveCreation(f: Awaited<ReturnType<typeof fixture>>) {
  assert.ok(f.person.email);
  const context = {
    publicationId: 'pub_fixture',
    id: 'evt_platform_creation',
    subscriptionId: 'sub_created',
    emailKey: `email:${await digestToken(f.person.email)}`,
  };
  await saveNewsletterEvent(f.db, {
    ...context,
    messageId: 'msg_platform_creation',
    type: 'subscription.created',
    occurredAt: f.now.toISOString(),
    encryptedEmail: await new NewsletterEventCipher(f.options.intentKey).encrypt(
      f.person.email,
      context,
    ),
    now: f.now,
  });
}

async function processCreation(f: Awaited<ReturnType<typeof fixture>>) {
  return await processNewsletterSourceEvents(queryBudget(f.db, 50).db, {
    publicationId: 'pub_fixture',
    intentKey: f.options.intentKey,
    now: f.now,
  });
}

void test('a creation callback before the API response finishes recovers without staff review or a second activation', async () => {
  const f = await fixture();
  try {
    f.beforeWrite(async () => {
      assert.equal(
        f.db.raw.prepare("SELECT count(*) AS n FROM identities WHERE platform='beehiiv'").get()?.n,
        0,
      );
      await saveCreation(f);
    });
    assert.equal((await reconcileBeehiivPerson(f.db, f.person.id, f.options)).kind, 'stale');
    assert.equal((await processCreation(f)).ignored, 1);
    const nextTick = { ...f.options, now: () => new Date(f.now.getTime() + 61_000) };
    assert.equal((await reconcileBeehiivPerson(f.db, f.person.id, nextTick)).kind, 'confirmed');
    assert.equal((await reconcileBeehiivPerson(f.db, f.person.id, nextTick)).kind, 'busy');
    assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
    assert.equal(
      f.db.raw
        .prepare("SELECT count(*) AS n FROM newsletter_inbound_events WHERE state='needs_review'")
        .get()?.n,
      0,
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 1);
    assert.equal(
      f.db.raw.prepare('SELECT encrypted_email FROM newsletter_inbound_events').get()
        ?.encrypted_email,
      null,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('a delayed platform creation clears automatically without reversing a later withdrawal', async () => {
  const f = await fixture();
  try {
    assert.equal((await reconcileBeehiivPerson(f.db, f.person.id, f.options)).kind, 'confirmed');
    await f.people.withdrawConsent(f.person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: f.now.toISOString(),
    });
    await saveCreation(f);
    assert.equal((await processCreation(f)).ignored, 1);
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'former_member');
    assert.equal((await reconcileBeehiivPerson(f.db, f.person.id, f.options)).kind, 'confirmed');
    assert.equal(f.subscriptions.get('sub_created')?.status, 'inactive');
    assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
  } finally {
    f.db.raw.close();
  }
});

void test('a delayed confirmation after an outbound activation cannot reverse a later withdrawal', async () => {
  const f = await fixture();
  try {
    assert.equal((await reconcileBeehiivPerson(f.db, f.person.id, f.options)).kind, 'confirmed');
    assert.ok(f.person.email);
    await f.people.withdrawConsent(f.person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: f.now.toISOString(),
    });
    const sourceTime = new Date(f.now.getTime() + 1000).toISOString();
    await saveNewsletterEvent(f.db, {
      publicationId: 'pub_fixture',
      id: 'evt_possible_echo',
      messageId: 'msg_possible_echo',
      type: 'subscription.confirmed',
      occurredAt: sourceTime,
      subscriptionId: 'sub_created',
      emailKey: `email:${await digestToken(f.person.email)}`,
      encryptedEmail: 'v1.fixture',
      now: new Date(f.now.getTime() + 2000),
    });
    const result = await f.people.applyNewsletterSourceEvent({
      publicationId: 'pub_fixture',
      eventId: 'evt_possible_echo',
      email: f.person.email,
      now: new Date(f.now.getTime() + 2000),
    });
    assert.equal(result.kind, 'needs_review');
    assert.equal((await f.people.getPerson(f.person.id))?.membership_status, 'former_member');
  } finally {
    f.db.raw.close();
  }
});
