import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountView,
  confirmEmailChange,
  leaveMailingList,
  rejoinMailingList,
  startEmailChange,
  updateArea,
  updatePhone,
  type AccountEnv,
} from '../platform/account';
import { deleteAccount, exportData, sendDeleteCode } from '../platform/account-data';
import { createSession, readSession } from '../platform/auth';
import type { GeocodeResult } from '../platform/integrations/census';
import { PersonService } from '../platform/storage/person-service';
import { everyStoredText, memoryDb, type MemoryDb } from './platform-db';

const CALLER = '203.0.113.9';

interface Call {
  url: string;
  method: string;
  body: string;
}

function fakeServices() {
  const calls: Call[] = [];
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
    });
    if (url.includes('beehiiv.com') && init?.method === 'POST') {
      return Promise.resolve(Response.json({ data: { id: `sub_${calls.length}` } }));
    }
    return Promise.resolve(Response.json({ id: 'ok' }));
  }) as typeof fetch;
  const emails = () =>
    calls
      .filter((call) => call.url.includes('resend'))
      .map((call) => JSON.parse(call.body) as { to: string[]; subject: string; text: string });
  return { calls, fetcher, emails };
}

function env(db: MemoryDb): AccountEnv {
  return {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'test-sign-in-secret',
    LVBT_RESEND_API_KEY: 're_test',
    LVBT_BEEHIIV_API_KEY: 'beehiiv-test-key-000000',
    LVBT_BEEHIIV_PUBLICATION_ID: 'pub_test',
  };
}

async function member(db: MemoryDb, email = 'ana@example.org') {
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email, given_name: 'Ana', phone: '+17025550123' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'beehiiv',
    externalId: `sub_${email}`,
    externalEmail: email,
    linkMethod: 'created_by_platform',
  });
  return person;
}

function codeFrom(subject: string | undefined): string {
  return /^(\d{6})/.exec(subject ?? '')?.[1] ?? '';
}

void test('the account shows membership, details and the mailing list', async () => {
  const db = memoryDb();
  const person = await member(db);
  const view = await accountView(db, person.id);
  assert.ok(view);
  assert.equal(view.onMailingList, true);
  assert.ok(view.memberSince);
  assert.equal(view.person.phone, '+17025550123');
});

void test('a phone number is saved in one form, removed when emptied, and checked', async () => {
  const db = memoryDb();
  const person = await member(db);
  assert.equal(await updatePhone(db, person.id, '(702) 555-0199'), 'updated');
  assert.equal((await new PersonService(db).getPerson(person.id))?.phone, '+17025550199');
  assert.equal(await updatePhone(db, person.id, '555'), 'invalid');
  assert.equal(await updatePhone(db, person.id, ''), 'updated');
  assert.equal((await new PersonService(db).getPerson(person.id))?.phone, null);
});

void test('an address sets the area and is never stored', async () => {
  const db = memoryDb();
  const person = await member(db);
  const found: GeocodeResult = {
    kind: 'match',
    censusBlock: '320030041011000',
    vintage: '2020',
    zip: '89110',
    places: ['Sunrise Manor CDP'],
  };
  const outcome = await updateArea(
    db,
    person.id,
    { address: '123 Example Street, Las Vegas, NV', zip: '' },
    { geocode: () => Promise.resolve(found) },
  );
  assert.equal(outcome, 'placed');
  const saved = await new PersonService(db).getPerson(person.id);
  assert.equal(saved?.census_block, '320030041011000');
  assert.equal(saved.zip, '89110');
  assert.ok(!everyStoredText(db).includes('Example Street'));

  const missed = await updateArea(
    db,
    person.id,
    { address: 'Nowhere', zip: '' },
    { geocode: () => Promise.resolve({ kind: 'no_match' }) },
  );
  assert.equal(missed, 'not_placed');
  assert.equal((await new PersonService(db).getPerson(person.id))?.zip, '89110');
});

void test('a ZIP code alone replaces an exact location', async () => {
  const db = memoryDb();
  const person = await member(db);
  assert.equal(await updateArea(db, person.id, { address: '', zip: '89104' }), 'updated');
  const saved = await new PersonService(db).getPerson(person.id);
  assert.equal(saved?.zip, '89104');
  assert.equal(saved.census_block, null);
  assert.equal(await updateArea(db, person.id, { address: '', zip: '891' }), 'invalid_zip');
});

void test('an email change waits for the code, then notifies the old address', async () => {
  const db = memoryDb();
  const person = await member(db);
  const { fetcher, emails, calls } = fakeServices();
  const started = await startEmailChange(
    env(db),
    person,
    { email: 'Ana.New@example.org', callerAddress: CALLER },
    fetcher,
  );
  assert.deepEqual(started, { kind: 'sent', newEmail: 'ana.new@example.org' });
  assert.equal((await new PersonService(db).getPerson(person.id))?.email, 'ana@example.org');
  const [codeEmail] = emails();
  assert.deepEqual(codeEmail.to, ['ana.new@example.org']);

  const confirmed = await confirmEmailChange(env(db), person, codeFrom(codeEmail.subject), fetcher);
  assert.deepEqual(confirmed, { kind: 'ok' });
  assert.equal((await new PersonService(db).getPerson(person.id))?.email, 'ana.new@example.org');
  const notice = emails().at(-1);
  assert.deepEqual(notice?.to, ['ana@example.org']);
  assert.match(notice.text, /changed to ana\.new@example\.org/);
  assert.ok(
    calls.some((call) => call.method === 'POST' && call.body.includes('ana.new@example.org')),
  );
});

void test('an email already on another record is refused', async () => {
  const db = memoryDb();
  const person = await member(db);
  await member(db, 'someone@example.org');
  const outcome = await startEmailChange(
    env(db),
    person,
    { email: 'someone@example.org', callerAddress: CALLER },
    fakeServices().fetcher,
  );
  assert.deepEqual(outcome, { kind: 'taken' });
});

void test('leaving makes a former member, and rejoining records a new consent', async () => {
  const db = memoryDb();
  const person = await member(db);
  const { fetcher, calls } = fakeServices();
  await leaveMailingList(env(db), person.id, fetcher);
  assert.equal(
    (await new PersonService(db).getPerson(person.id))?.membership_status,
    'former_member',
  );
  assert.ok(calls.some((call) => call.method === 'DELETE' || call.method === 'PATCH'));

  assert.equal(await rejoinMailingList(env(db), person, fetcher), 'rejoined');
  assert.equal((await new PersonService(db).getPerson(person.id))?.membership_status, 'member');
  const sources = db.raw
    .prepare('SELECT source FROM consent_records WHERE withdrawn_at IS NULL')
    .all() as { source: string }[];
  assert.deepEqual(
    sources.map((row) => row.source),
    ['account'],
  );
});

void test('the download holds everything about this member and nothing about anyone else', async () => {
  const db = memoryDb();
  const person = await member(db);
  await member(db, 'someone@example.org');
  const data = await exportData(db, person.id);
  assert.ok(data);
  const text = JSON.stringify(data);
  assert.match(String(data.summary), /^Everything LVBT holds about Ana, downloaded /);
  assert.ok(text.includes('ana@example.org'));
  assert.ok(!text.includes('someone@example.org'));
  assert.equal((data.consent_records as unknown[]).length, 1);
  assert.equal((data.connected_accounts as unknown[]).length, 1);
});

void test('deleting needs a fresh code, then clears details and signs out everywhere', async () => {
  const db = memoryDb();
  const person = await member(db);
  const session = await createSession(env(db), person.id, 'member');
  const { fetcher, emails } = fakeServices();

  assert.equal((await deleteAccount(env(db), person, '123456', fetcher)).kind, 'expired');
  assert.deepEqual(await sendDeleteCode(env(db), person, CALLER, fetcher), { kind: 'sent' });
  const code = codeFrom(emails()[0]?.subject);
  assert.deepEqual(await deleteAccount(env(db), person, code, fetcher), { kind: 'ok' });

  const row = db.raw
    .prepare('SELECT email, given_name, phone, deleted_at FROM people WHERE id = ?')
    .get(person.id) as {
    email: string | null;
    given_name: string | null;
    phone: string | null;
    deleted_at: string;
  };
  assert.equal(row.email, null);
  assert.equal(row.given_name, null);
  assert.equal(row.phone, null);
  assert.ok(row.deleted_at);
  assert.equal(await readSession(env(db), session.token), null);
});
