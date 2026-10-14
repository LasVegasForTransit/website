import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { saveNewsletterEvent } from '../src/newsletter-inbound';
import { newsletterEmailKey } from '../src/newsletter-work';
import { claimNewsletterJob, releaseNewsletterLease } from '../src/newsletter-sync-store';

for (const retained of [false, true]) {
  for (const foreign of [false, true]) {
    void test(`publication fencing: retained address=${retained}, foreign publication=${foreign}`, async () => {
      const db = memoryDb();
      const people = new PersonService(db);
      try {
        const { person } = await people.upsertFromSource({
          source: 'join_form',
          fields: { email: 'current@example.invalid' },
          consent: {
            scope: 'newsletter',
            source: 'join_form',
            method: 'checkbox',
            wordingVersion: 'fixture',
          },
        });
        const now = new Date(Date.now() + 1000);
        const address = retained ? 'retained@example.invalid' : 'current@example.invalid';
        const selectedPublication = foreign ? 'pub_previous' : 'pub_current';
        if (retained)
          await db
            .prepare(
              'INSERT INTO newsletter_write_intents(id,publication_id,person_id,account_key,encrypted_email,created_at) VALUES(?,?,?,?,?,?)',
            )
            .bind(
              'intent_retained',
              selectedPublication,
              person.id,
              await newsletterEmailKey(address),
              'v1.fixture',
              now.toISOString(),
            )
            .run();
        await saveNewsletterEvent(db, {
          publicationId: retained ? 'pub_current' : selectedPublication,
          id: 'evt_waiting',
          messageId: 'msg_waiting',
          type: 'subscription.deleted',
          occurredAt: new Date(now.getTime() - 60_000).toISOString(),
          subscriptionId: 'sub_waiting',
          emailKey: await newsletterEmailKey(address),
          encryptedEmail: 'v1.fixture',
          now,
        });
        const lease = await claimNewsletterJob(db, person.id, 'pub_current', now);
        assert.equal(
          Boolean(lease),
          foreign,
          'only this publication’s current or retained addresses may fence its job',
        );
        if (lease) await releaseNewsletterLease(db, lease);
        assert.equal(
          db.raw.prepare('SELECT state FROM newsletter_inbound_events').get()?.state,
          'pending',
        );
      } finally {
        db.raw.close();
      }
    });
  }
}
