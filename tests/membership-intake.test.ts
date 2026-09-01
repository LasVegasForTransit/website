import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { onRequestPost } from '../functions/api/membership-intake';

type FetchCall = {
  url: string;
  init: RequestInit;
};

const baseEnv = {
  LVBT_BEEHIIV_API_KEY: 'beehiiv-key',
  LVBT_BEEHIIV_PUBLICATION_ID: 'pub_123',
  LVBT_MEMBERSHIP_INTAKE_SECRET: 'intake-secret',
  LVBT_NOTION_API_KEY: 'notion-key',
  LVBT_NOTION_DATA_SOURCE_ID: 'notion-data-source',
};

const calls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  calls.length = 0;
  globalThis.fetch = originalFetch;
});

// Every mocked call answers in order from `statuses` (200 once exhausted).
// Notion's data-source query answers with `existingPages` so a test can
// simulate a replay; `throwAt` makes that call (1-based) reject instead.
function mockFetch(statuses: number[] = [], existingPages: unknown[] = [], throwAt?: number) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (calls.length === throwAt) throw new TypeError('fetch failed');
    const status = statuses.shift() ?? 200;
    const body = url.endsWith('/query') ? { results: existingPages } : { ok: status < 300 };
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

function call(index: number): FetchCall {
  const entry = calls[index];
  assert.ok(entry, `expected a fetch call at index ${index}`);
  return entry;
}

function callBody(index: number): Record<string, any> {
  return JSON.parse(String(call(index).init.body));
}

const NOTION_QUERY_URL = 'https://api.notion.com/v1/data_sources/notion-data-source/query';

function context(body: unknown, env = baseEnv, headers: HeadersInit = {}) {
  return {
    env,
    request: new Request('https://lasvegasfortransit.org/api/membership-intake', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer intake-secret',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  } as Parameters<typeof onRequestPost>[0];
}

test('subscribes a valid form response and creates a Notion intake page', async () => {
  mockFetch();

  const response = await onRequestPost(
    context({
      email: ' Rider@Example.COM ',
      name: 'Test Rider',
      discord: 'testrider#0001',
      sourceForm: 'Membership interest',
      submittedAt: '2026-06-15T18:00:00.000Z',
      rawResponseUrl: 'https://docs.google.com/spreadsheets/d/example',
      responseId: 'form-response-id',
      answers: {
        Name: 'Test Rider',
        Interests: 'Bus reliability, Safer stops',
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, notion: 'created' });
  assert.equal(calls.length, 3);

  const beehiiv = call(0);
  assert.equal(beehiiv.url, 'https://api.beehiiv.com/v2/publications/pub_123/subscriptions');
  assert.equal(beehiiv.init.method, 'POST');
  assert.equal(
    (beehiiv.init.headers as Record<string, string>).Authorization,
    'Bearer beehiiv-key',
  );
  assert.deepEqual(callBody(0), {
    email: 'rider@example.com',
    reactivate_existing: true,
    send_welcome_email: false,
    double_opt_override: 'off',
  });

  assert.equal(call(1).url, NOTION_QUERY_URL);
  assert.deepEqual(callBody(1).filter, {
    property: 'Response ID',
    rich_text: { equals: 'form-response-id' },
  });

  const notion = call(2);
  assert.equal(notion.url, 'https://api.notion.com/v1/pages');
  assert.equal(notion.init.method, 'POST');
  assert.equal((notion.init.headers as Record<string, string>).Authorization, 'Bearer notion-key');
  assert.equal((notion.init.headers as Record<string, string>)['Notion-Version'], '2026-03-11');

  const notionBody = callBody(2);
  assert.deepEqual(notionBody.parent, { data_source_id: 'notion-data-source' });
  assert.equal(notionBody.properties.Email.email, 'rider@example.com');
  assert.equal(notionBody.properties.Name.title[0].text.content, 'Test Rider');
  assert.equal(notionBody.properties.Discord.rich_text[0].text.content, 'testrider#0001');
  assert.equal(notionBody.properties.Source.rich_text[0].text.content, 'Membership interest');
  assert.equal(
    notionBody.properties['Raw response'].url,
    'https://docs.google.com/spreadsheets/d/example',
  );
  assert.equal(notionBody.properties['Submitted at'].date.start, '2026-06-15T18:00:00.000Z');

  const blockText = (block: {
    bulleted_list_item: { rich_text: { text: { content: string } }[] };
  }) => block.bulleted_list_item.rich_text[0].text.content;
  assert.equal(notionBody.children.length, 2);
  assert.equal(notionBody.children[0].type, 'bulleted_list_item');
  assert.equal(blockText(notionBody.children[0]), 'Name: Test Rider');
  assert.equal(blockText(notionBody.children[1]), 'Interests: Bus reliability, Safer stops');
});

test('renders a placeholder paragraph when no answers are supplied', async () => {
  mockFetch();

  await onRequestPost(context({ email: 'rider@example.com' }));

  const notionBody = callBody(2);
  assert.equal(notionBody.children.length, 1);
  assert.equal(notionBody.children[0].type, 'paragraph');
  assert.equal(
    notionBody.children[0].paragraph.rich_text[0].text.content,
    'No additional answers supplied.',
  );
});

test('rejects requests without the intake bearer token', async () => {
  mockFetch();

  const response = await onRequestPost(
    context({ email: 'rider@example.com' }, baseEnv, {
      Authorization: 'Bearer wrong-secret',
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
  assert.equal(calls.length, 0);
});

test('rejects invalid email without calling downstream systems', async () => {
  mockFetch();

  const response = await onRequestPost(context({ email: 'not-an-email' }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_email' });
  assert.equal(calls.length, 0);
});

test('rejects non-object JSON without calling downstream systems', async () => {
  mockFetch();

  const response = await onRequestPost(context(null));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_body' });
  assert.equal(calls.length, 0);
});

test('reports missing runtime configuration before downstream calls', async () => {
  mockFetch();

  const response = await onRequestPost(
    context(
      { email: 'rider@example.com' },
      {
        ...baseEnv,
        LVBT_NOTION_API_KEY: '',
      },
    ),
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'service_unavailable',
    missing: ['LVBT_NOTION_API_KEY'],
  });
  assert.equal(calls.length, 0);
});

test('reports Beehiiv subscription failure', async () => {
  mockFetch([500]);

  const response = await onRequestPost(context({ email: 'rider@example.com' }));

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'subscription_failed' });
  // The duplicate lookup runs alongside the subscribe; the page create does not.
  assert.equal(calls.length, 2);
});

test('reports Notion sync failure when the duplicate lookup fails', async () => {
  mockFetch([200, 500]);

  const response = await onRequestPost(context({ email: 'rider@example.com' }));

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'notion_sync_failed' });
  assert.equal(calls.length, 2);
});

test('reports Notion sync failure when the page create fails', async () => {
  mockFetch([200, 200, 500]);

  const response = await onRequestPost(context({ email: 'rider@example.com' }));

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'notion_sync_failed' });
  assert.equal(calls.length, 3);
});

test('does not create a second Notion page for a replayed response', async () => {
  mockFetch([200, 200], [{ id: 'page-1' }]);

  const response = await onRequestPost(
    context({ email: 'rider@example.com', responseId: 'form-response-id' }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, notion: 'existing' });
  assert.equal(calls.length, 2);
});

test('dedupes by email when the request carries no response ID', async () => {
  mockFetch([200, 200], [{ id: 'page-1' }]);

  const response = await onRequestPost(context({ email: 'Rider@Example.com' }));

  assert.equal(response.status, 200);
  assert.deepEqual(callBody(1).filter, {
    property: 'Email',
    email: { equals: 'rider@example.com' },
  });
  assert.equal(calls.length, 2);
});

test('reports Beehiiv as failed when the request itself throws', async () => {
  mockFetch([], [], 1);

  const response = await onRequestPost(context({ email: 'rider@example.com' }));

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'subscription_failed' });
});

test('reports Notion as failed when the lookup throws after Beehiiv succeeds', async () => {
  mockFetch([], [], 2);

  const response = await onRequestPost(context({ email: 'rider@example.com' }));

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'notion_sync_failed' });
  assert.equal(calls.length, 2);
});

test('rejects a non-string email without calling downstream systems', async () => {
  mockFetch();

  const response = await onRequestPost(context({ email: 12345 }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_email' });
  assert.equal(calls.length, 0);
});

test('treats non-string optional fields as absent instead of failing', async () => {
  mockFetch();

  const response = await onRequestPost(
    context({
      email: 'rider@example.com',
      name: 42,
      discord: { handle: 'x' },
      sourceForm: null,
      submittedAt: 1750000000,
      rawResponseUrl: ['https://example.com'],
      responseId: true,
    }),
  );

  assert.equal(response.status, 200);
  const notionBody = callBody(2);
  assert.equal(notionBody.properties.Name.title[0].text.content, 'rider@example.com');
  assert.deepEqual(notionBody.properties.Discord.rich_text, []);
  assert.equal(
    notionBody.properties.Source.rich_text[0].text.content,
    'Google Forms membership intake',
  );
  assert.deepEqual(notionBody.properties['Submitted at'], { date: null });
  assert.deepEqual(notionBody.properties['Raw response'], { url: null });
  assert.deepEqual(notionBody.properties['Response ID'].rich_text, []);
});

test('caps the Notion page body at the 100-block create limit', async () => {
  mockFetch();
  const answers = Object.fromEntries(
    Array.from({ length: 150 }, (_, i) => [`Question ${i + 1}`, `Answer ${i + 1}`]),
  );

  const response = await onRequestPost(context({ email: 'rider@example.com', answers }));

  assert.equal(response.status, 200);
  const notionBody = callBody(2);
  assert.equal(notionBody.children.length, 100);
  assert.equal(notionBody.children[98].type, 'bulleted_list_item');
  assert.equal(notionBody.children[99].type, 'paragraph');
  assert.match(notionBody.children[99].paragraph.rich_text[0].text.content, /51 more answer/);
});

test('does not reveal missing configuration to unauthenticated callers', async () => {
  mockFetch();

  const response = await onRequestPost(
    context(
      { email: 'rider@example.com' },
      { ...baseEnv, LVBT_NOTION_API_KEY: '' },
      {
        Authorization: 'Bearer wrong-secret',
      },
    ),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
  assert.equal(calls.length, 0);
});

test('reports a missing intake secret since no caller could authenticate', async () => {
  mockFetch();

  const response = await onRequestPost(
    context({ email: 'rider@example.com' }, { ...baseEnv, LVBT_MEMBERSHIP_INTAKE_SECRET: '' }),
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'service_unavailable',
    missing: ['LVBT_MEMBERSHIP_INTAKE_SECRET'],
  });
  assert.equal(calls.length, 0);
});
