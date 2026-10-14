import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../functions/api/intake/v1';
import { googleFormSubmission, parseIntake, processIntake } from '../platform/intake';
import { memoryDb, type MemoryDb } from '@lasvegasfortransit/platform-storage/test-db';

const TOKEN = 'intake-token-for-tests';

function submission(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: 'gform-1',
    source: 'google_form',
    submittedAt: '2026-10-05T18:22:10Z',
    person: { givenName: 'Ana', familyName: 'Reyes', email: 'Ana@Example.org', zip: '89104' },
    consent: { newsletter: true, wordingVersion: 'gform-2026-06' },
    interests: ['events'],
    heardFrom: 'A friend',
    ...overrides,
  };
}

async function post(db: MemoryDb, body: unknown, token = TOKEN): Promise<Response> {
  const request = new Request('https://lasvegasfortransit.org/api/intake/v1', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const env = {
    PLATFORM_DB: db,
    LVBT_MEMBERSHIP_INTAKE_SECRET: TOKEN,
    LVBT_LINK_SIGNING_SECRET: 'unused',
  };
  return onRequestPost({ env, request } as unknown as Parameters<typeof onRequestPost>[0]);
}

void test('a valid submission records consent and queues delivery without a provider request', async (t) => {
  const db = memoryDb();
  const fetcher = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('intake must not call the provider');
  });
  const parsed = parseIntake(submission());
  assert.ok(parsed.ok);
  const outcome = await processIntake({ PLATFORM_DB: db }, parsed.submission);
  assert.deepEqual(outcome, { kind: 'processed', response: { action: 'created' } });
  const person = db.raw
    .prepare('SELECT given_name, family_name, email, zip, membership_status FROM people')
    .get();
  assert.deepEqual(
    { ...person },
    {
      given_name: 'Ana',
      family_name: 'Reyes',
      email: 'ana@example.org',
      zip: '89104',
      membership_status: 'member',
    },
  );
  const consent = db.raw
    .prepare('SELECT source, method, wording_version FROM consent_records')
    .get();
  assert.deepEqual(
    { ...consent },
    { source: 'google_form', method: 'checkbox', wording_version: 'gform-2026-06' },
  );
  assert.equal(fetcher.mock.callCount(), 0);
  assert.equal(db.raw.prepare('SELECT state FROM newsletter_sync_jobs').get()?.state, 'queued');
});

void test('the same idempotency key returns the first answer and changes nothing', async () => {
  const db = memoryDb();
  const first = await post(db, submission({ consent: undefined }));
  const second = await post(
    db,
    submission({ consent: undefined, person: { email: 'other@example.org' } }),
  );
  assert.deepEqual(await first.json(), { action: 'created' });
  assert.deepEqual(await second.json(), { action: 'created' });
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
});

void test('a wrong or missing token is refused and writes nothing', async () => {
  const db = memoryDb();
  const response = await post(db, submission(), 'wrong-token');
  assert.equal(response.status, 401);
  const body = await response.json<{ error: string }>();
  assert.equal(body.error, 'unauthorized');
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
});

void test('invalid fields are named without echoing the values', async () => {
  const db = memoryDb();
  const response = await post(db, submission({ person: { email: 'not-an-email@' } }));
  assert.equal(response.status, 400);
  const text = await response.text();
  assert.ok(!text.includes('not-an-email'));
  assert.deepEqual((JSON.parse(text) as { fields: string[] }).fields, ['person.email']);
});

void test('the required fields are the key, source, time and email', () => {
  const parsed = parseIntake({});
  assert.deepEqual(parsed, {
    ok: false,
    fields: ['idempotencyKey', 'source', 'submittedAt', 'person.email'],
  });
  assert.equal(parseIntake(submission({ source: 'somewhere_else' })).ok, false);
});

void test('an existing person is linked and learns nothing about anyone else', async () => {
  const db = memoryDb();
  await post(db, submission({ consent: undefined }));
  const again = await post(
    db,
    submission({
      idempotencyKey: 'gform-2',
      consent: undefined,
      person: { email: 'ana@example.org' },
    }),
  );
  assert.deepEqual(await again.json(), { action: 'linked' });
});

void test('the Google Form payload becomes a version 1 submission with consent', () => {
  const converted = googleFormSubmission({
    email: 'ana@example.org',
    name: 'Ana Maria Reyes',
    submittedAt: '2026-10-05T18:22:10Z',
    responseId: 'abc',
    answers: {
      'Finishing this form will sign you up for our email newsletter. Is this okay?': 'Yes',
    },
  });
  assert.equal(converted.idempotencyKey, 'gform-abc');
  assert.equal(converted.source, 'google_form');
  assert.deepEqual(converted.person, {
    email: 'ana@example.org',
    givenName: 'Ana',
    familyName: 'Maria Reyes',
  });
  assert.deepEqual(converted.consent, { newsletter: true, wordingVersion: 'gform-2026-06' });
});
