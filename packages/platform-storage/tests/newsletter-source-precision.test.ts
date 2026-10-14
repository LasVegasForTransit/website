import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { saveNewsletterEvent } from '../src/newsletter-inbound';
import { newsletterEmailKey } from '../src/newsletter-work';
import { loadNewsletterPlan, newsletterPlanIsCurrent } from '../src/newsletter-plan';

void test('an unsubscribe in the signup second stays under review instead of allowing the address to be subscribed again', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const email = 'rapid-unsubscribe@example.invalid';
  try {
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email },
      emailVerified: true,
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
        givenAt: '2026-10-14T10:00:00.500Z',
      },
    });
    await people.linkIdentity(person.id, {
      platform: 'beehiiv',
      externalId: 'sub_rapid',
      externalEmail: email,
      linkMethod: 'verified_email',
    });
    await saveNewsletterEvent(db, {
      publicationId: 'pub_rapid',
      id: 'evt_rapid',
      messageId: 'msg_rapid',
      subscriptionId: 'sub_rapid',
      type: 'subscription.deleted',
      occurredAt: '2026-10-14T10:00:00.000Z',
      emailKey: await newsletterEmailKey(email),
      encryptedEmail: 'fixture-private-address',
      now: new Date('2026-10-14T12:00:00.000Z'),
    });
    const result = await people.applyNewsletterSourceEvent({
      publicationId: 'pub_rapid',
      eventId: 'evt_rapid',
      email,
      now: new Date('2026-10-14T12:00:00.000Z'),
    });
    assert.equal(result.kind, 'needs_review');
    assert.equal(
      db.raw.prepare('SELECT reason FROM newsletter_source_operations').get()?.reason,
      'source_time_conflict',
    );
    assert.equal(
      db.raw.prepare('SELECT withdrawn_at FROM consent_records').get()?.withdrawn_at,
      null,
    );
    const plan = await loadNewsletterPlan(db, person.id);
    assert.ok(plan);
    assert.equal(await newsletterPlanIsCurrent(db, plan, 'pub_rapid'), false);
  } finally {
    db.raw.close();
  }
});
