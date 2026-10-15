import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import {
  claimBeehiivPoll,
  saveBeehiivPollPage,
} from '@lasvegasfortransit/platform-storage/beehiiv-poll-store';

void test('private newsletter review denies untrusted requests and returns plain information without secrets', async () => {
  const module = await import('../src/newsletter-review').catch(() => null);
  assert.ok(module, 'the staff portal needs a private newsletter review service');
  const db = memoryDb();
  try {
    const people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'admin@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    db.raw
      .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
      .run(person.id, 'fixture', new Date().toISOString());
    const { person: backup } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'backup@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    db.raw
      .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
      .run(backup.id, 'fixture', new Date().toISOString());
    const now = new Date();
    const scan = await claimBeehiivPoll(db, 'pub_review', now);
    assert.ok(typeof scan !== 'string');
    await saveBeehiivPollPage(db, scan, {
      rows: [
        { id: 'sub_unknown', status: 'active', created: Math.floor(now.getTime() / 1000) - 3600 },
      ],
      nextCursor: null,
      now,
    });
    const env = {
      PLATFORM_DB: db,
      LVBT_DEPLOYMENT_ENV: 'preview',
      LVBT_BEEHIIV_SYNC_ENABLED: 'false',
      LVBT_BEEHIIV_PUBLICATION_ID: 'pub_review',
      LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID: 'pub_production',
      LVBT_BEEHIIV_API_KEY: 'fixture-api-key',
      LVBT_NEWSLETTER_INTENT_KEY: 'a'.repeat(43),
    };
    const input = {
      actorId: person.id,
      action: 'detail',
      ref: { kind: 'poll', id: 'sub_unknown', revision: 1 },
    };
    const request = (value: unknown, url = 'https://jobs.internal/newsletter/review') =>
      new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
    assert.equal(
      (
        await module.handleNewsletterReviewRequest(
          request(input, 'https://public.invalid/newsletter/review'),
          env,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await module.handleNewsletterReviewRequest(
          request({ ...input, actorId: 'not-an-admin' }),
          env,
        )
      ).status,
      403,
    );
    const response = await module.handleNewsletterReviewRequest(request(input), env, {
      fetcher: async () =>
        await Promise.resolve(
          Response.json({
            data: {
              id: 'sub_unknown',
              email: 'new-rider@example.invalid',
              status: 'active',
              created: Math.floor(now.getTime() / 1000) - 3600,
            },
          }),
        ),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.text();
    assert.ok(body.includes('new-rider@example.invalid'));
    assert.ok(!body.includes('fixture-api-key'));
    assert.ok(!body.includes('encryptedEmail'));
    assert.ok(!body.includes('emailKey'));
    assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
    const revoked = await module.handleNewsletterReviewRequest(request(input), env, {
      fetcher: async () => {
        db.raw
          .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
          .run(person.id);
        return await Promise.resolve(
          Response.json({
            data: {
              id: 'sub_unknown',
              email: 'new-rider@example.invalid',
              status: 'active',
              created: Math.floor(now.getTime() / 1000) - 3600,
            },
          }),
        );
      },
    });
    assert.equal(revoked.status, 403, 'authorization must still hold after awaiting the provider');
  } finally {
    db.raw.close();
  }
});
