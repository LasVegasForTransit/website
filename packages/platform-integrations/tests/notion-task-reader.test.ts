import assert from 'node:assert/strict';
import test from 'node:test';

const sourceId = '10000000-0000-4000-8000-000000000001';
const pageId = '10000000-0000-4000-8000-000000000002';
const options = {
  sourceId,
  shareDescription: false,
  rangeBoundary: 'reject' as const,
  fields: {
    name: 'Task name',
    description: 'Description',
    assignee: 'Assignee',
    due: 'Due date',
    status: 'Status',
    project: 'Project',
  },
};
function page() {
  return {
    object: 'page',
    id: pageId,
    last_edited_time: '2026-10-20T12:00:00Z',
    parent: { data_source_id: sourceId },
    url: `https://www.notion.so/${pageId.replaceAll('-', '')}`,
    archived: false,
    in_trash: false,
    properties: {
      'Task name': { type: 'title', title: [{ plain_text: 'Prepare agenda' }] },
      Description: { type: 'rich_text', rich_text: [{ plain_text: 'PRIVATE-DESCRIPTION' }] },
      Assignee: {
        id: 'people',
        type: 'people',
        people: [{ id: 'guest-user' }, { id: 'member-user' }],
      },
      'Due date': { type: 'date', date: { start: '2026-10-23', end: null } },
      Status: { type: 'status', status: { name: 'In progress' } },
      Project: { id: 'projects', type: 'relation', relation: [{ id: pageId }], has_more: false },
    },
  };
}
async function modules() {
  const reader = await import('../src/notion-task-reader').catch(() => null);
  const client = await import('../src/notion-task-client').catch(() => null);
  assert.ok(reader, 'Notion task normalization must exist');
  assert.ok(client, 'bounded Notion transport must exist');
  return { ...reader, ...client };
}

void test('current Notion app links remain deliverable while lookalike domains are rejected', async () => {
  const { parseNotionTaskPage } = await modules();
  const url = `https://app.notion.com/${pageId.replaceAll('-', '')}`;
  assert.equal(parseNotionTaskPage({ ...page(), url }, options)?.snapshot.url, url);
  assert.equal(
    parseNotionTaskPage(
      { ...page(), url: url.replace('app.notion.com', 'app.notion.com.example.invalid') },
      options,
    )?.snapshot.url,
    '',
  );
});

void test('normalizes guest IDs and dates without copying unapproved private content or user profiles', async () => {
  const { parseNotionTaskPage } = await modules();
  const task = parseNotionTaskPage(page(), options);
  assert.ok(task);
  assert.equal(task.active, true);
  assert.equal(task.snapshot.title, 'Prepare agenda');
  assert.deepEqual(task.snapshot.assigneeIds, ['guest-user', 'member-user']);
  assert.equal(task.snapshot.dueDate, '2026-10-23');
  assert.equal(JSON.stringify(task).includes('PRIVATE-DESCRIPTION'), false);
  const raw = page();
  raw.properties.Status.status.name = 'Done';
  assert.equal(parseNotionTaskPage(raw, options)?.active, false);
});
void test('assignee names are bounded display hints without copied account profiles', async () => {
  const { parseNotionTaskPage } = await modules(),
    raw = page();
  const task = parseNotionTaskPage(
    {
      ...raw,
      properties: {
        ...raw.properties,
        Assignee: {
          ...raw.properties.Assignee,
          people: [
            {
              id: 'guest-user',
              name: ' Alex\nGuest ',
              person: { email: 'PRIVATE-ADDRESS' },
              avatar_url: 'PRIVATE-AVATAR',
            },
            { id: 'member-user', name: 'M'.repeat(300) },
          ],
        },
      },
    },
    options,
  );
  assert.ok(task);
  assert.deepEqual(task.snapshot.assigneeLabels, [
    { id: 'guest-user', name: 'Alex Guest' },
    { id: 'member-user', name: 'M'.repeat(160) },
  ]);
  assert.equal(JSON.stringify(task).includes('PRIVATE-'), false);
  assert.deepEqual(task.snapshot.assigneeIds, ['guest-user', 'member-user']);
});

void test('unconfirmed date ranges, malformed dates, missing names, and incomplete assignee lists cannot deliver', async () => {
  const { parseNotionTaskPage } = await modules();
  const raw = page();
  const range = {
    ...raw,
    properties: {
      ...raw.properties,
      'Due date': { type: 'date', date: { start: '2026-10-22', end: '2026-10-23' } },
    },
  };
  assert.equal(parseNotionTaskPage(range, options)?.active, false);
  assert.equal(
    parseNotionTaskPage(range, { ...options, rangeBoundary: 'end' })?.snapshot.dueDate,
    '2026-10-23',
  );
  const malformed = {
    ...raw,
    properties: {
      ...raw.properties,
      'Due date': { type: 'date', date: { start: '2026-02-30', end: null } },
    },
  };
  assert.equal(parseNotionTaskPage(malformed, options)?.active, false);
  const unnamed = {
    ...raw,
    properties: { ...raw.properties, 'Task name': { type: 'title', title: [] } },
  };
  assert.equal(parseNotionTaskPage(unnamed, options)?.active, false);
  const truncated = {
    ...raw,
    properties: {
      ...raw.properties,
      Assignee: {
        ...raw.properties.Assignee,
        people: Array.from({ length: 25 }, (_, i) => ({ id: `person-${i}` })),
      },
    },
  };
  assert.equal(parseNotionTaskPage(truncated, options)?.active, false);
  assert.equal(
    parseNotionTaskPage({ ...raw, parent: { data_source_id: 'other-source' } }, options),
    null,
  );
});

void test('queries the configured source with bounded pages and the returned cursor', async () => {
  const { NotionTaskClient } = await modules();
  const requests: { url: string; body: unknown; version: string | null }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    requests.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '') as unknown,
      version: new Headers(init?.headers).get('Notion-Version'),
    });
    return Promise.resolve(
      Response.json({ results: [page()], has_more: true, next_cursor: 'next-page' }),
    );
  };
  const client = new NotionTaskClient('secret-token', fetcher);
  const result = await client.queryTasks(sourceId, 'previous-page');
  assert.equal(result.nextCursor, 'next-page');
  assert.deepEqual(requests, [
    {
      url: `https://api.notion.com/v1/data_sources/${sourceId}/query`,
      body: { page_size: 20, start_cursor: 'previous-page' },
      version: '2025-09-03',
    },
  ]);
});

void test('rate limits and ambiguous source responses fail without echoing response bodies or credentials', async () => {
  const { NotionTaskClient, NotionTaskApiError } = await modules();
  const limited = new NotionTaskClient('secret-token', () =>
    Promise.resolve(
      new Response('PRIVATE-PROVIDER-TEXT', { status: 429, headers: { 'Retry-After': '120' } }),
    ),
  );
  await assert.rejects(limited.queryTasks(sourceId), (error: unknown) => {
    assert.ok(error instanceof NotionTaskApiError);
    assert.equal(error.retryAfterMs, 120_000);
    assert.equal(error.message.includes('PRIVATE'), false);
    return true;
  });
  const incomplete = new NotionTaskClient('secret-token', () =>
    Promise.resolve(
      Response.json({
        results: [],
        has_more: false,
        next_cursor: null,
        request_status: { type: 'incomplete' },
      }),
    ),
  );
  await assert.rejects(incomplete.queryTasks(sourceId));
  const redirect = new NotionTaskClient('secret-token', () =>
    Promise.resolve(
      new Response(null, { status: 302, headers: { Location: 'https://elsewhere.invalid' } }),
    ),
  );
  await assert.rejects(redirect.queryTasks(sourceId));
});
