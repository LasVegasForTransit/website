import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { memoryDb, everyStoredText } from '@lasvegasfortransit/platform-storage/test-db';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import { handleNewsletterEventRequest } from '../src/newsletter-event';
const now = new Date('2026-10-14T12:00:00.000Z');
const key = 'fixture-webhook-key-only';
function message(extra: Record<string, unknown> = {}) {
  const body = JSON.stringify({
    event_type: 'subscription.deleted',
    event_timestamp: 1791892800,
    uid: 'evt_fixture',
    data: {
      id: 'sub_fixture',
      email: 'private@example.invalid',
      status: 'active',
      custom_fields: [{ name: 'private', value: 'omit this field' }],
    },
    ...extra,
  });
  const signature = createHmac('sha256', key)
    .update(`msg_fixture.${now.getTime() / 1000}.${body}`)
    .digest('base64');
  return new Request('https://jobs.internal/newsletter/event', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'svix-id': 'msg_fixture',
      'svix-timestamp': String(now.getTime() / 1000),
      'svix-signature': `v1,${signature}`,
    },
  });
}
function environment(db: ReturnType<typeof memoryDb>) {
  return {
    PLATFORM_DB: db,
    LVBT_DEPLOYMENT_ENV: 'preview',
    LVBT_BEEHIIV_SYNC_ENABLED: 'true',
    LVBT_BEEHIIV_PUBLICATION_ID: 'pub_fixture',
    LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID: 'pub_production',
    LVBT_BEEHIIV_API_KEY: 'fixture-api-key',
    LVBT_NEWSLETTER_INTENT_KEY: randomToken(),
    LVBT_BEEHIIV_WEBHOOK_SECRET: `whsec_${btoa(key)}`,
  };
}
void test('acknowledges only durable authenticated minimal events and rejects replay collisions', async () => {
  const db = memoryDb();
  try {
    const env = environment(db);
    for (let i = 0; i < 2; i++)
      assert.equal((await handleNewsletterEventRequest(message(), env, now)).status, 200);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM newsletter_inbound_events').get()?.n, 1);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM newsletter_inbound_deliveries').get()?.n,
      1,
    );
    assert.equal(
      (await handleNewsletterEventRequest(message({ uid: 'evt_other' }), env, now)).status,
      409,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM newsletter_inbound_events').get()?.n, 1);
    const stored = everyStoredText(db);
    assert.ok(!stored.includes('private@example.invalid'));
    assert.ok(!stored.includes('omit this field'));
    assert.ok(!stored.includes(key));
  } finally {
    db.raw.close();
  }
});
void test('forgery, disabled or cross-environment setup and oversize bodies store nothing', async () => {
  const db = memoryDb();
  try {
    const env = environment(db),
      forged = message();
    forged.headers.set('svix-signature', 'v1,invalid');
    assert.equal((await handleNewsletterEventRequest(forged, env, now)).status, 401);
    assert.equal(
      (
        await handleNewsletterEventRequest(
          message(),
          { ...env, LVBT_BEEHIIV_SYNC_ENABLED: 'false' },
          now,
        )
      ).status,
      503,
    );
    assert.equal(
      (
        await handleNewsletterEventRequest(
          message(),
          { ...env, LVBT_BEEHIIV_PUBLICATION_ID: 'pub_production' },
          now,
        )
      ).status,
      503,
    );
    assert.equal(
      (await handleNewsletterEventRequest(message({ padding: 'x'.repeat(65_536) }), env, now))
        .status,
      413,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM newsletter_inbound_events').get()?.n, 0);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM newsletter_inbound_deliveries').get()?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});
void test('a failed inbox transaction is never acknowledged', async () => {
  const db = memoryDb();
  try {
    db.raw.exec(
      "CREATE TRIGGER refuse_delivery BEFORE INSERT ON newsletter_inbound_deliveries BEGIN SELECT RAISE(ABORT,'fixture storage outage'); END",
    );
    assert.equal((await handleNewsletterEventRequest(message(), environment(db), now)).status, 503);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM newsletter_inbound_events').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
