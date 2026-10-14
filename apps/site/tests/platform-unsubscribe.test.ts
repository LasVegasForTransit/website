import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../functions/join/remove';
import { signToken } from '@lasvegasfortransit/platform-core/signing';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';

void test('one-click unsubscribe accepts withdrawal without a session or provider availability', async (t) => {
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'one-click@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'beehiiv',
    externalId: 'sub_one_click',
    externalEmail: 'one-click@example.org',
    linkMethod: 'created_by_platform',
  });
  const token = await signToken('test-secret', {
    purpose: 'remove_email',
    subject: person.id,
    expiresAt: Date.now() + 60_000,
  });
  const invoke = () =>
    onRequestPost({
      env: {
        PLATFORM_DB: db,
        LVBT_LINK_SIGNING_SECRET: 'test-secret',
        LVBT_BEEHIIV_API_KEY: 'test-api-key',
        LVBT_BEEHIIV_PUBLICATION_ID: 'pub_test',
      },
      request: new Request(`https://lasvegasfortransit.org/join/remove/?token=${token}`, {
        method: 'POST',
        body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }),
      }),
    } as unknown as Parameters<typeof onRequestPost>[0]);

  const upstream = t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(new Response(null, { status: 503 })),
  );
  assert.equal((await invoke()).status, 200);
  assert.ok(db.raw.prepare('SELECT withdrawn_at FROM consent_records').get()?.withdrawn_at);
  assert.equal(await people.getPerson(person.id), null);
  assert.equal(db.raw.prepare('SELECT email FROM people').get()?.email, null);
  assert.equal(
    db.raw.prepare('SELECT state FROM newsletter_sync_jobs WHERE person_id=?').get(person.id)
      ?.state,
    'queued',
  );
  assert.equal((await invoke()).status, 200);
  const { person: replacement } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'one-click@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  assert.notEqual(replacement.id, person.id);
  const beforeReplay = db.raw
    .prepare('SELECT * FROM newsletter_sync_jobs WHERE person_id=?')
    .get(replacement.id);
  assert.equal((await invoke()).status, 200);
  assert.equal((await people.getPerson(replacement.id))?.membership_status, 'member');
  assert.deepEqual(
    db.raw.prepare('SELECT * FROM newsletter_sync_jobs WHERE person_id=?').get(replacement.id),
    beforeReplay,
  );
  assert.equal(upstream.mock.callCount(), 0);
});

void test('one-click unsubscribe rejects forged links', async () => {
  const response = await onRequestPost({
    env: { PLATFORM_DB: memoryDb(), LVBT_LINK_SIGNING_SECRET: 'test-secret' },
    request: new Request('https://lasvegasfortransit.org/join/remove/?token=forged.token', {
      method: 'POST',
      body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }),
    }),
  } as unknown as Parameters<typeof onRequestPost>[0]);
  assert.equal(response.status, 400);
});

void test('a signed removal cannot acknowledge an unknown or recoverable subject', async () => {
  const db = memoryDb();
  try {
    const people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'staff',
      fields: { email: 'recoverable@example.invalid' },
    });
    await db
      .prepare('UPDATE people SET deleted_at=? WHERE id=?')
      .bind(new Date().toISOString(), person.id)
      .run();
    for (const payload of [
      { purpose: 'remove_email', subject: 'unknown-subject', expiresAt: Date.now() + 60_000 },
      { purpose: 'remove_email', subject: person.id, expiresAt: Date.now() + 60_000 },
      { purpose: 'remove_email', subject: person.id, expiresAt: Date.now() - 1000 },
      { purpose: 'another-purpose', subject: person.id, expiresAt: Date.now() + 60_000 },
    ]) {
      const token = await signToken('test-secret', payload);
      const response = await onRequestPost({
        env: { PLATFORM_DB: db, LVBT_LINK_SIGNING_SECRET: 'test-secret' },
        request: new Request(`https://lasvegasfortransit.org/join/remove/?token=${token}`, {
          method: 'POST',
          body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }),
        }),
      } as unknown as Parameters<typeof onRequestPost>[0]);
      assert.equal(response.status, 400);
    }
    assert.equal(
      db.raw.prepare('SELECT email,erased_at FROM people WHERE id=?').get(person.id)?.erased_at,
      null,
    );
  } finally {
    db.raw.close();
  }
});
