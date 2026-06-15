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

function mockFetch(statuses: number[]) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const status = statuses.shift() ?? 200;
    return new Response(JSON.stringify({ ok: status >= 200 && status < 300 }), { status });
  }) as typeof fetch;
}

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
  mockFetch([200, 200]);

  const response = await onRequestPost(
    context({
      email: ' Rider@Example.COM ',
      name: 'Test Rider',
      discord: 'testrider#0001',
      sourceForm: 'Membership interest',
      submittedAt: '2026-06-15T18:00:00.000Z',
      rawResponseUrl: 'https://docs.google.com/spreadsheets/d/example',
      answers: {
        Name: 'Test Rider',
        Interests: 'Bus reliability, Safer stops',
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(calls.length, 2);

  const beehiiv = calls[0];
  assert.ok(beehiiv);
  assert.equal(beehiiv.url, 'https://api.beehiiv.com/v2/publications/pub_123/subscriptions');
  assert.equal(beehiiv.init.method, 'POST');
  assert.equal(
    (beehiiv.init.headers as Record<string, string>).Authorization,
    'Bearer beehiiv-key',
  );
  assert.deepEqual(JSON.parse(String(beehiiv.init.body)), {
    email: 'rider@example.com',
    reactivate_existing: true,
    send_welcome_email: true,
    double_opt_override: 'on',
  });

  const notion = calls[1];
  assert.ok(notion);
  assert.equal(notion.url, 'https://api.notion.com/v1/pages');
  assert.equal(notion.init.method, 'POST');
  assert.equal((notion.init.headers as Record<string, string>).Authorization, 'Bearer notion-key');
  assert.equal((notion.init.headers as Record<string, string>)['Notion-Version'], '2026-03-11');

  const notionBody = JSON.parse(String(notion.init.body));
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
  mockFetch([200, 200]);

  await onRequestPost(context({ email: 'rider@example.com' }));

  const notion = calls[1];
  assert.ok(notion);
  const notionBody = JSON.parse(String(notion.init.body));
  assert.equal(notionBody.children.length, 1);
  assert.equal(notionBody.children[0].type, 'paragraph');
  assert.equal(
    notionBody.children[0].paragraph.rich_text[0].text.content,
    'No additional answers supplied.',
  );
});

test('rejects requests without the intake bearer token', async () => {
  mockFetch([200, 200]);

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
  mockFetch([200, 200]);

  const response = await onRequestPost(context({ email: 'not-an-email' }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_email' });
  assert.equal(calls.length, 0);
});

test('rejects non-object JSON without calling downstream systems', async () => {
  mockFetch([200, 200]);

  const response = await onRequestPost(context(null));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_body' });
  assert.equal(calls.length, 0);
});

test('reports missing runtime configuration before downstream calls', async () => {
  mockFetch([200, 200]);

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
  assert.deepEqual(await response.json(), { error: 'service_unavailable' });
  assert.equal(calls.length, 0);
});

test('reports Beehiiv subscription failure', async () => {
  mockFetch([500]);

  const response = await onRequestPost(context({ email: 'rider@example.com' }));

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'subscription_failed' });
  assert.equal(calls.length, 1);
});

test('reports Notion sync failure after Beehiiv succeeds', async () => {
  mockFetch([200, 500]);

  const response = await onRequestPost(context({ email: 'rider@example.com' }));

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'notion_sync_failed' });
  assert.equal(calls.length, 2);
});
