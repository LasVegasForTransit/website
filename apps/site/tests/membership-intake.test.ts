import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { welcomeQueue } from '../../../packages/platform-storage/src/welcome-queue';
import { onRequestPost } from '../functions/api/membership-intake';

const question = 'Finishing this form will sign you up for our email newsletter. Is this okay?';
function payload() {
  return {
    email: ' Rider@Example.COM ',
    name: 'Test Rider',
    responseId: 'form-response-id',
    sourceForm: 'Membership interest',
    submittedAt: new Date(Date.now() - 86_400_000).toISOString(),
    answers: { [question]: 'Yes' },
  };
}
function fixture(t: test.TestContext) {
  const db = memoryDb();
  t.after(() => db.raw.close());
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', (input: RequestInfo | URL) => {
    calls.push(input instanceof Request ? input.url : String(input));
    return Promise.resolve(Response.json({ results: [] }));
  });
  const post = (body: unknown, overrides: Record<string, unknown> = {}, token = 'intake-secret') =>
    onRequestPost({
      env: { PLATFORM_DB: db, LVBT_MEMBERSHIP_INTAKE_SECRET: 'intake-secret', ...overrides },
      request: new Request('https://lasvegasfortransit.org/api/membership-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    } as unknown as Parameters<typeof onRequestPost>[0]);
  return { db, calls, post };
}

void test('the original Google Form creates a canonical welcome entry without Notion configuration or calls', async (t) => {
  const f = fixture(t);
  const input = payload();
  const response = await f.post(input);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(f.calls, []);
  const person = f.db.raw
    .prepare('SELECT id,email,given_name,family_name,membership_status FROM people')
    .get();
  assert.ok(person);
  assert.ok(typeof person.id === 'string');
  assert.equal(person.email, 'rider@example.com');
  assert.equal(person.given_name, 'Test');
  assert.equal(person.family_name, 'Rider');
  assert.equal(person.membership_status, 'member');
  const consent = f.db.raw
    .prepare('SELECT source,given_at,wording_version FROM consent_records')
    .get();
  assert.deepEqual(
    { ...consent },
    { source: 'google_form', given_at: input.submittedAt, wording_version: 'gform-2026-06' },
  );
  const engagement = f.db.raw
    .prepare("SELECT type,source,occurred_at FROM engagement_events WHERE type='joined'")
    .get();
  assert.deepEqual(
    { ...engagement },
    { type: 'joined', source: 'google_form', occurred_at: input.submittedAt },
  );
  assert.equal(f.db.raw.prepare('SELECT state FROM newsletter_sync_jobs').get()?.state, 'queued');
  f.db.raw
    .prepare(
      'INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,?,?)',
    )
    .run(person.id, 'fixture', new Date().toISOString());
  const queue = await welcomeQueue(f.db, person.id, { now: new Date() });
  assert.ok(queue.items[0]);
  assert.equal(queue.items[0].personId, person.id);
  assert.equal(queue.items[0].source, 'google_form');
});

void test('leftover Notion credentials never cause a lookup or new page', async (t) => {
  const f = fixture(t);
  const response = await f.post(payload(), {
    LVBT_NOTION_API_KEY: 'old-notion-key',
    LVBT_NOTION_DATA_SOURCE_ID: 'old-notion-source',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(f.calls, []);
});

void test('replaying an original response preserves one canonical join and one delivery job', async (t) => {
  const f = fixture(t);
  const input = payload();
  assert.equal((await f.post(input)).status, 200);
  assert.equal((await f.post(input)).status, 200);
  for (const table of ['people', 'consent_records', 'newsletter_sync_jobs', 'intake_submissions']) {
    assert.equal(f.db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 1, table);
  }
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM engagement_events WHERE type='joined'").get()?.n,
    1,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n, 2);
  assert.deepEqual(f.calls, []);
});

void test('rejects an invalid bearer before creating a canonical record', async (t) => {
  const f = fixture(t);
  const response = await f.post(payload(), {}, 'wrong-secret');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  assert.deepEqual(f.calls, []);
});

void test('rejects invalid bodies and emails without records or provider calls', async (t) => {
  const f = fixture(t);
  for (const [body, error] of [
    [null, 'invalid_body'],
    [{ email: 'not-an-email' }, 'invalid_email'],
    [{ email: 123 }, 'invalid_email'],
  ] as const) {
    const response = await f.post(body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error });
  }
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  assert.deepEqual(f.calls, []);
});

void test('requires the configured intake secret and canonical database', async (t) => {
  const f = fixture(t);
  for (const name of ['LVBT_MEMBERSHIP_INTAKE_SECRET', 'PLATFORM_DB']) {
    const response = await f.post(payload(), { [name]: undefined });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'service_unavailable', missing: [name] });
  }
  assert.deepEqual(f.calls, []);
});

void test('canonical write failure returns a retryable failure without leaking storage details', async (t) => {
  const f = fixture(t);
  f.db.raw.exec(
    "CREATE TRIGGER reject_person BEFORE INSERT ON people BEGIN SELECT RAISE(ABORT,'private-storage-details'); END",
  );
  const response = await f.post(payload());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'service_unavailable' });
  assert.deepEqual(f.calls, []);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
});

void test('missing or malformed optional fields do not create consent or prevent recording a response', async (t) => {
  const f = fixture(t);
  const response = await f.post({
    email: 'rider@example.com',
    name: 42,
    discord: {},
    submittedAt: 123,
    responseId: true,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(
    f.db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'not_member',
  );
  assert.equal(f.db.raw.prepare('SELECT given_name FROM people').get()?.given_name, null);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  assert.equal(f.db.raw.prepare('SELECT type FROM engagement_events').get()?.type, 'form_response');
  assert.deepEqual(f.calls, []);
});
