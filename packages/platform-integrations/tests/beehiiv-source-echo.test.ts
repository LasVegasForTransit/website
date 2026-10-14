import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './support/beehiiv-sync-fixture';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { saveNewsletterEvent } from '@lasvegasfortransit/platform-storage/newsletter-inbound';
import { reconcileBeehiivPerson } from '../src/beehiiv-sync';

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
