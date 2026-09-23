import assert from 'node:assert/strict';
import test from 'node:test';
import { readJoinForm, type JoinInput } from '../platform/core/join-form';
import type { GeocodeResult } from '../platform/integrations/census';
import { processJoin, type PlatformEnv } from '../platform/join';
import { removeEmail } from '../platform/remove';
import { everyStoredText, memoryDb, type MemoryDb } from './platform-db';

interface Call {
  url: string;
  body: string;
}

function fakeServices() {
  const calls: Call[] = [];
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, body });
    if (url.includes('beehiiv.com') && init?.method === 'POST') {
      return Promise.resolve(Response.json({ data: { id: `sub_${calls.length}` } }));
    }
    if (url.includes('notion.com') && url.endsWith('/query')) {
      return Promise.resolve(Response.json({ results: [] }));
    }
    return Promise.resolve(Response.json({ id: 'ok' }));
  }) as typeof fetch;
  return { calls, fetcher };
}

function sentEmail(calls: Call[]): { subject: string; text: string } {
  const body = calls.find((call) => call.url.includes('resend'))?.body ?? '{}';
  return JSON.parse(body) as { subject: string; text: string };
}

function env(db: MemoryDb): PlatformEnv {
  return {
    PLATFORM_DB: db,
    LVBT_LINK_SIGNING_SECRET: 'test-signing-secret',
    LVBT_BEEHIIV_API_KEY: 'beehiiv-test-key-000000',
    LVBT_BEEHIIV_PUBLICATION_ID: 'pub_test',
    LVBT_NOTION_API_KEY: 'notion-test-key-000000',
    LVBT_NOTION_DATA_SOURCE_ID: '00000000000000000000000000000000',
    LVBT_RESEND_API_KEY: 're_test',
  };
}

function form(fields: Record<string, string | string[]>): JoinInput {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
  }
  return readJoinForm(data);
}

const inSunriseManor: GeocodeResult = {
  kind: 'match',
  censusBlock: '320030041011000',
  vintage: '2020',
  zip: '89110',
  places: ['Sunrise Manor CDP'],
};

void test('joining with only an email and the box ticked makes a member everywhere', async () => {
  const db = memoryDb();
  const { calls, fetcher } = fakeServices();
  const outcome = await processJoin(
    env(db),
    form({ email: 'ana@example.org', consent: 'yes', form_token: 't1' }),
    '203.0.113.1',
    { fetcher },
  );
  assert.equal(outcome.kind, 'joined');
  const person = db.raw.prepare('SELECT membership_status, email FROM people').get() as {
    membership_status: string;
  };
  assert.equal(person.membership_status, 'member');
  const consent = db.raw.prepare('SELECT method, wording_version FROM consent_records').get();
  assert.deepEqual({ ...consent }, { method: 'checkbox', wording_version: 'join-form-v1' });
  assert.ok(calls.some((call) => call.url.includes('beehiiv.com')));
  assert.ok(calls.some((call) => call.url === 'https://api.resend.com/emails'));
  assert.ok(calls.some((call) => call.url.endsWith('/pages')));
  const email = sentEmail(calls);
  assert.equal(email.subject, 'Welcome to LVBT');
  assert.match(email.text, /\/join\/remove\/\?token=/);
});

void test('without the box ticked nothing is saved', async () => {
  const db = memoryDb();
  const { calls, fetcher } = fakeServices();
  const outcome = await processJoin(env(db), form({ email: 'ana@example.org' }), '203.0.113.1', {
    fetcher,
  });
  assert.deepEqual(outcome, { kind: 'invalid', errors: { consent: 'required' } });
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  assert.equal(calls.length, 0);
});

void test('an invalid email and a short ZIP code are reported together', async () => {
  const outcome = await processJoin(
    env(memoryDb()),
    form({ email: 'not-an-email', zip: '891', consent: 'yes' }),
    '203.0.113.1',
    { fetcher: fakeServices().fetcher },
  );
  assert.deepEqual(outcome, { kind: 'invalid', errors: { email: 'invalid', zip: 'invalid' } });
});

void test('a filled honeypot is quietly discarded', async () => {
  const db = memoryDb();
  const { calls, fetcher } = fakeServices();
  const outcome = await processJoin(
    env(db),
    form({ email: 'bot@example.org', consent: 'yes', website: 'spam' }),
    '203.0.113.1',
    { fetcher },
  );
  assert.equal(outcome.kind, 'discarded');
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  assert.equal(calls.length, 0);
});

void test('the eleventh join from one connection in an hour is refused', async () => {
  const db = memoryDb();
  const { fetcher } = fakeServices();
  for (let i = 0; i < 10; i += 1) {
    const outcome = await processJoin(
      env(db),
      form({ email: `p${i}@example.org`, consent: 'yes' }),
      '203.0.113.9',
      { fetcher },
    );
    assert.equal(outcome.kind, 'joined');
  }
  const eleventh = await processJoin(
    env(db),
    form({ email: 'p11@example.org', consent: 'yes' }),
    '203.0.113.9',
    { fetcher },
  );
  assert.equal(eleventh.kind, 'rate_limited');
  const other = await processJoin(
    env(db),
    form({ email: 'q@example.org', consent: 'yes' }),
    '198.51.100.4',
    { fetcher },
  );
  assert.equal(other.kind, 'joined');
});

void test('submitting the same form twice joins once and sends one email', async () => {
  const db = memoryDb();
  const { calls, fetcher } = fakeServices();
  const submission = { email: 'ana@example.org', consent: 'yes', form_token: 'same' };
  const first = await processJoin(env(db), form(submission), '203.0.113.1', { fetcher });
  const second = await processJoin(env(db), form(submission), '203.0.113.1', { fetcher });
  assert.equal(first.kind, 'joined');
  assert.equal(second.kind, 'joined');
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
  assert.equal(calls.filter((call) => call.url.includes('resend')).length, 1);
  assert.equal(
    calls.filter((call) => call.url.includes('beehiiv.com')).length,
    1,
    'Beehiiv is called once',
  );
});

void test('an address sets the census block and region, and the street address is never stored', async () => {
  const db = memoryDb();
  const { fetcher } = fakeServices();
  const address = '4800 E Sahara Ave, Las Vegas, NV 89110';
  const outcome = await processJoin(
    env(db),
    form({ email: 'ana@example.org', consent: 'yes', address }),
    '203.0.113.1',
    { fetcher, geocode: () => Promise.resolve(inSunriseManor) },
  );
  assert.equal(outcome.kind, 'joined');
  assert.equal(outcome.needsRegion, false);
  const person = db.raw
    .prepare('SELECT census_block, census_block_vintage, zip, region_id, region_source FROM people')
    .get();
  assert.deepEqual(
    { ...person },
    {
      census_block: '320030041011000',
      census_block_vintage: '2020',
      zip: '89110',
      region_id: 'east_las_vegas',
      region_source: 'address',
    },
  );
  assert.ok(!everyStoredText(db).includes('Sahara'));
});

void test('a Las Vegas city address or no location asks for the region', async () => {
  const db = memoryDb();
  const { fetcher } = fakeServices();
  const inLasVegas: GeocodeResult = { ...inSunriseManor, places: ['Las Vegas city'] };
  const withAddress = await processJoin(
    env(db),
    form({ email: 'a@example.org', consent: 'yes', address: '495 S Main St' }),
    '203.0.113.1',
    { fetcher, geocode: () => Promise.resolve(inLasVegas) },
  );
  const withNothing = await processJoin(
    env(db),
    form({ email: 'b@example.org', consent: 'yes' }),
    '203.0.113.1',
    { fetcher },
  );
  assert.equal(withAddress.kind === 'joined' && withAddress.needsRegion, true);
  assert.equal(withNothing.kind === 'joined' && withNothing.needsRegion, true);
});

void test('an address the Geocoder cannot place keeps only the ZIP code', async () => {
  const db = memoryDb();
  const outcome = await processJoin(
    env(db),
    form({ email: 'ana@example.org', consent: 'yes', zip: '89104', address: '1 Nowhere Rd' }),
    '203.0.113.1',
    { fetcher: fakeServices().fetcher, geocode: () => Promise.resolve({ kind: 'no_match' }) },
  );
  assert.equal(outcome.kind === 'joined' && outcome.address, 'not_placed');
  const person = db.raw.prepare('SELECT zip, census_block FROM people').get();
  assert.deepEqual({ ...person }, { zip: '89104', census_block: null });
});

void test('if Beehiiv fails, nothing is recorded so the person can try again', async () => {
  const db = memoryDb();
  const failing = (() =>
    Promise.resolve(new Response('down', { status: 500 }))) as unknown as typeof fetch;
  const outcome = await processJoin(
    env(db),
    form({ email: 'ana@example.org', consent: 'yes', form_token: 'x' }),
    '203.0.113.1',
    { fetcher: failing },
  );
  assert.equal(outcome.kind, 'unavailable');
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
});

void test('the newsletter box joins the same way with its own consent wording', async () => {
  const db = memoryDb();
  const outcome = await processJoin(
    env(db),
    form({ origin: 'newsletter_box', email: 'ana@example.org', consent: 'yes' }),
    '203.0.113.1',
    { fetcher: fakeServices().fetcher },
  );
  assert.equal(outcome.kind === 'joined' && outcome.needsRegion, false);
  const consent = db.raw.prepare('SELECT source, wording_version FROM consent_records').get();
  assert.deepEqual(
    { ...consent },
    { source: 'newsletter_box', wording_version: 'newsletter-box-v1' },
  );
});

void test('the removal link withdraws consent and deletes someone with no other history', async () => {
  const db = memoryDb();
  const { calls, fetcher } = fakeServices();
  await processJoin(env(db), form({ email: 'ana@example.org', consent: 'yes' }), '203.0.113.1', {
    fetcher,
  });
  const email = sentEmail(calls);
  const token = decodeURIComponent(/token=([^\s]+)/.exec(email.text)?.[1] ?? '');

  assert.equal(await removeEmail(env(db), 'forged.token', fetcher), 'invalid');
  assert.equal(await removeEmail(env(db), token, fetcher), 'removed');
  const person = db.raw.prepare('SELECT email, deleted_at FROM people').get() as {
    email: string | null;
    deleted_at: string | null;
  };
  assert.equal(person.email, null);
  assert.ok(person.deleted_at);
  assert.ok(calls.some((call) => call.url.includes('/subscriptions/sub_')));
  assert.equal(await removeEmail(env(db), token, fetcher), 'invalid');
});
