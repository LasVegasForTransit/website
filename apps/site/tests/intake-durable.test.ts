import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { onRequestPost as legacyPost } from '../functions/api/membership-intake';
import { onRequestPost as versionedPost } from '../functions/api/intake/v1';
import { googleFormSubmission } from '../platform/intake';
const question = 'Finishing this form will sign you up for our email newsletter. Is this okay?';
function fixture(t: test.TestContext, notionFails = false) {
  const db = memoryDb();
  t.after(() => db.raw.close());
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    return Promise.resolve(
      Response.json(url.endsWith('/query') ? { results: [] } : { data: { id: 'sub_fixture' } }, {
        status: notionFails ? 503 : 200,
      }),
    );
  });
  const env = {
    PLATFORM_DB: db,
    LVBT_MEMBERSHIP_INTAKE_SECRET: 'fixture-secret',
    LVBT_NOTION_API_KEY: 'fixture-only',
    LVBT_NOTION_DATA_SOURCE_ID: 'fixture-source',
  };
  const post = (body: unknown, legacy = true, configured = false) => {
    const request = new Request(
      `https://lasvegasfortransit.org/api/${legacy ? 'membership-intake' : 'intake/v1'}`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer fixture-secret', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const runtime = configured
      ? { ...env, LVBT_BEEHIIV_API_KEY: 'fixture-only', LVBT_BEEHIIV_PUBLICATION_ID: 'pub_fixture' }
      : env;
    const context = { request, env: runtime } as unknown as Parameters<typeof legacyPost>[0] &
      Parameters<typeof versionedPost>[0];
    return legacy ? legacyPost(context) : versionedPost(context);
  };
  return { db, post, calls };
}
function payload(answer: unknown = 'Yes') {
  return {
    email: 'intake@example.invalid',
    name: 'Intake Member',
    responseId: 'fixture-response',
    submittedAt: '2026-06-15T18:00:00.000Z',
    answers: { [question]: answer },
  };
}
void test('legacy intake saves the original consent and queues delivery without Beehiiv credentials', async (t) => {
  const f = fixture(t);
  assert.equal((await f.post(payload())).status, 200);
  assert.equal(
    f.db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'member',
  );
  assert.equal(
    f.db.raw.prepare('SELECT given_at FROM consent_records').get()?.given_at,
    payload().submittedAt,
  );
  assert.equal(f.db.raw.prepare('SELECT state FROM newsletter_sync_jobs').get()?.state, 'queued');
  assert.equal(
    f.calls.every((url) => url.startsWith('https://api.notion.com/')),
    true,
  );
});
void test('versioned intake records accepted consent during a newsletter outage', async (t) => {
  const f = fixture(t);
  const input = payload();
  assert.equal(
    (
      await f.post(
        {
          idempotencyKey: 'versioned-fixture',
          source: 'external_form',
          submittedAt: input.submittedAt,
          person: { email: input.email },
          consent: { newsletter: true, wordingVersion: 'fixture' },
        },
        false,
      )
    ).status,
    200,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.db.raw.prepare('SELECT state FROM newsletter_sync_jobs').get()?.state, 'queued');
});
void test('an older Google Form replay cannot undo a newer membership withdrawal', async (t) => {
  const f = fixture(t);
  const people = new PersonService(f.db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: payload().email },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: '2026-06-01T00:00:00.000Z',
    },
  });
  await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2026-07-01T00:00:00.000Z',
  });
  assert.equal((await f.post(payload(), true, true)).status, 200);
  assert.equal((await people.getPerson(person.id))?.membership_status, 'former_member');
  assert.equal(
    f.calls.some((url) => url.includes('beehiiv')),
    false,
  );
});
void test('Notion failure cannot discard the accepted membership record or delivery work', async (t) => {
  const f = fixture(t, true);
  assert.equal((await f.post(payload(), true, true)).status, 502);
  assert.equal(
    f.db.raw.prepare('SELECT given_at FROM consent_records').get()?.given_at,
    payload().submittedAt,
  );
  assert.equal(f.db.raw.prepare('SELECT state FROM newsletter_sync_jobs').get()?.state, 'queued');
});
void test('blank, negative or un-timestamped form answers do not invent newsletter consent', () => {
  for (const answer of [undefined, '', 'No'])
    assert.equal(
      googleFormSubmission({ ...payload(), answers: { [question]: answer } }).consent,
      undefined,
    );
  assert.equal(googleFormSubmission({ ...payload(), submittedAt: undefined }).consent, undefined);
});

function versioned(idempotencyKey: string, email = 'intake@example.invalid') {
  return {
    idempotencyKey,
    source: 'external_form',
    submittedAt: payload().submittedAt,
    person: { email },
    consent: { newsletter: true, wordingVersion: 'fixture' },
  };
}
void test('an interrupted receipt resumes without renewing old consent or duplicating engagement', async (t) => {
  const f = fixture(t);
  f.db.raw.exec(
    "CREATE TRIGGER receipt_failure BEFORE INSERT ON intake_submissions BEGIN SELECT RAISE(ABORT,'private-storage-details'); END",
  );
  const failed = await f.post(versioned('interrupted'), false);
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes('private-storage-details'), false);
  const person = f.db.raw.prepare('SELECT id FROM people').get();
  assert.ok(person && typeof person.id === 'string');
  await new PersonService(f.db).withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2026-07-01T00:00:00.000Z',
  });
  f.db.raw.exec('DROP TRIGGER receipt_failure');
  const retried = await f.post(versioned('interrupted'), false);
  assert.equal(retried.status, 200);
  assert.equal(
    f.db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'former_member',
  );
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM engagement_events WHERE type='joined'").get()?.n,
    1,
  );
});
void test('completed receipts survive profile erasure without recreating a person or retaining their email', async (t) => {
  const f = fixture(t);
  const input = versioned('private-intake@example.invalid');
  assert.equal((await f.post(input, false)).status, 200);
  const person = f.db.raw.prepare('SELECT id FROM people').get();
  assert.ok(person && typeof person.id === 'string');
  await new PersonService(f.db).deletePerson(person.id);
  assert.deepEqual(await (await f.post(input, false)).json(), { action: 'created' });
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM people WHERE deleted_at IS NULL').get()?.n,
    0,
  );
  const receipt = f.db.raw.prepare('SELECT idempotency_key,response FROM intake_submissions').get();
  assert.equal(JSON.stringify(receipt).includes('@'), false);
});
void test('existing plaintext receipts migrate while keeping their original answer and expiry', async (t) => {
  const f = fixture(t);
  const stamp = new Date().toISOString();
  f.db.raw
    .prepare(
      'INSERT INTO intake_submissions VALUES(?,\'external_form\',\'{"action":"created"}\',?,?)',
    )
    .run('legacy@example.invalid', stamp, stamp);
  const response = await f.post(versioned('legacy@example.invalid'), false);
  assert.deepEqual(await response.json(), { action: 'created' });
  const rows = f.db.raw.prepare('SELECT idempotency_key,created_at FROM intake_submissions').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.created_at, stamp);
  assert.equal(JSON.stringify(rows).includes('@'), false);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
});
void test('an opaque source key cannot masquerade as another hashed receipt', async (t) => {
  const f = fixture(t);
  assert.equal((await f.post(versioned('original'), false)).status, 200);
  const row = f.db.raw.prepare('SELECT idempotency_key FROM intake_submissions').get();
  assert.ok(row && typeof row.idempotency_key === 'string');
  assert.equal(
    (await f.post(versioned(row.idempotency_key, 'second@example.invalid'), false)).status,
    200,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 2);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM intake_submissions').get()?.n, 2);
});
void test('a form without consent is recorded as a response rather than an LVBT join', async (t) => {
  const f = fixture(t);
  assert.equal((await f.post({ ...payload(), answers: { [question]: 'No' } })).status, 200);
  assert.equal(
    f.db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'not_member',
  );
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM engagement_events WHERE type='joined'").get()?.n,
    0,
  );
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM engagement_events WHERE type='form_response'").get()
      ?.n,
    1,
  );
});
