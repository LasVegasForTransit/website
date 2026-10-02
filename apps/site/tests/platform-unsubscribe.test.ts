import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../functions/join/remove';
import { signToken } from '../platform/core/signing';
import { PersonService } from '../platform/storage/person-service';
import { memoryDb } from './support/platform-db';

void test('one-click unsubscribe needs no session and updates the mailing list and consent', async (t) => {
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

  t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(null, { status: 503 })));
  assert.equal((await invoke()).status, 503);
  assert.equal((await people.getPerson(person.id))?.membership_status, 'member');
  assert.equal(
    db.raw.prepare('SELECT withdrawn_at FROM consent_records').get()?.withdrawn_at,
    null,
  );

  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    assert.equal(init.method, 'PATCH');
    assert.ok(typeof init.body === 'string');
    assert.deepEqual(JSON.parse(init.body), { unsubscribe: true });
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  assert.equal((await invoke()).status, 200);
  assert.ok(db.raw.prepare('SELECT withdrawn_at FROM consent_records').get()?.withdrawn_at);
  assert.equal(await people.getPerson(person.id), null);
  assert.equal(db.raw.prepare('SELECT email FROM people').get()?.email, null);
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
