import assert from 'node:assert/strict';
import test from 'node:test';
import { NotionTaskClient } from '../src/notion-task-client';
import { taskPolicy } from './support/task-checkins';
import { fixture, page, now, pageId } from './support/task-action-fixture';

async function actions() {
  const module = await import('../src/notion-task-actions').catch(() => null);
  assert.ok(module, 'current-state Notion action processing must exist');
  return module;
}
void test('rechecks current assignment, revision, action policy and Discord membership before a Notion write', async () => {
  const { processNotionTaskAction } = await actions();
  for (const change of [
    'assignment',
    'revision',
    'policy',
    'membership',
    'consent-during-read',
    'content-same-timestamp',
  ]) {
    const db = await fixture();
    let writes = 0;
    const raw = page();
    if (change === 'content-same-timestamp')
      raw.properties['Task name'].title = [{ plain_text: 'New scope' }];
    if (change === 'assignment') raw.properties.Assignee.people = [{ id: 'other' }];
    if (change === 'revision') raw.last_edited_time = '2026-10-20T16:01:00Z';
    if (change === 'policy')
      db.raw
        .prepare('UPDATE task_checkin_sources SET policy_json=?')
        .run(
          JSON.stringify({ ...taskPolicy, actions: { ...taskPolicy.actions, progress: false } }),
        );
    const client = new NotionTaskClient('token', (_url, init) => {
      if (init?.method !== 'GET') writes++;
      if (change === 'consent-during-read')
        db.raw.prepare("UPDATE task_checkin_consents SET state='paused'").run();
      return Promise.resolve(Response.json(raw));
    });
    try {
      await processNotionTaskAction(db, client, 'response', {
        membership: () => Promise.resolve(change !== 'membership'),
        clock: () => now,
      });
      assert.equal(writes, 0, change);
    } finally {
      db.raw.close();
    }
  }
});
void test('progress, blockers and extension requests become comments; completion only changes status; snooze stays local', async () => {
  const { processNotionTaskAction } = await actions();
  for (const kind of ['progress', 'blocker', 'extension', 'complete', 'snooze'] as const) {
    const db = await fixture(kind),
      writes: { url: string; body: unknown }[] = [];
    const client = new NotionTaskClient('token', (url, init) => {
      if (init?.method === 'GET') return Promise.resolve(Response.json(page()));
      writes.push({
        url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
        body: JSON.parse(typeof init?.body === 'string' ? init.body : '') as unknown,
      });
      if (kind === 'complete') {
        const response = page();
        response.properties.Status.status.name = 'Done';
        return Promise.resolve(Response.json(response));
      }
      return Promise.resolve(Response.json({ object: 'comment', id: pageId }));
    });
    try {
      const options = { membership: () => Promise.resolve(true), clock: () => now };
      await processNotionTaskAction(db, client, 'response', options);
      await processNotionTaskAction(db, client, 'response', options);
      assert.equal(
        db.raw.prepare("SELECT state FROM task_checkin_operations WHERE id='response'").get()
          ?.state,
        'confirmed',
        kind,
      );
      assert.equal(writes.length, kind === 'snooze' ? 0 : 1, kind);
      if (kind === 'complete')
        assert.deepEqual(writes[0]?.body, { properties: { Status: { status: { name: 'Done' } } } });
      else if (kind !== 'snooze') {
        assert.match(JSON.stringify(writes[0]?.body), /The agenda is ready/);
        assert.match(JSON.stringify(writes[0]?.body), /lvbt_update=response/);
        assert.equal(JSON.stringify(writes[0]?.body).includes('due_date'), false);
      } else
        assert.equal(
          db.raw.prepare('SELECT snoozed_until FROM task_checkin_cards').get()?.snoozed_until,
          '2026-10-21T16:00:00.000Z',
        );
    } finally {
      db.raw.close();
    }
  }
});
void test('an uncertain comment is held and reconciles only by a positive operation reference, never by absence', async () => {
  const { processNotionTaskAction, reconcileNotionTaskComment } = await actions();
  const db = await fixture();
  let writes = 0,
    found = false,
    authentic = false,
    clockNow = now;
  const client = new NotionTaskClient(
    'token',
    (url, init) => {
      if (init?.method === 'POST') {
        writes++;
        return Promise.reject(new Error('timeout'));
      }
      if (
        (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith(
          '/users/me',
        )
      )
        return Promise.resolve(
          Response.json({ object: 'user', id: 'integration-bot', type: 'bot' }),
        );
      if (
        (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes(
          '/comments?',
        )
      )
        return Promise.resolve(
          Response.json({
            results: found
              ? [
                  {
                    object: 'comment',
                    id: pageId,
                    created_by: { id: authentic ? 'integration-bot' : 'another-user' },
                    parent: { page_id: pageId },
                    rich_text: [
                      {
                        type: 'text',
                        text: {
                          content: 'Sent from Discord',
                          link: {
                            url: `https://www.notion.so/${pageId.replaceAll('-', '')}?lvbt_update=response`,
                          },
                        },
                      },
                    ],
                  },
                ]
              : [],
            has_more: false,
            next_cursor: null,
          }),
        );
      return Promise.resolve(Response.json(page()));
    },
    { maxRequests: 100, deadline: now.getTime() + 3600000, clock: () => clockNow },
  );
  try {
    const options = { membership: () => Promise.resolve(true), clock: () => clockNow };
    await processNotionTaskAction(db, client, 'response', options);
    assert.equal(db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state, 'held');
    await assert.rejects(
      reconcileNotionTaskComment(db, client, 'response', () => clockNow),
      /provider_cooldown/,
    );
    clockNow = new Date(now.getTime() + 60000);
    await reconcileNotionTaskComment(db, client, 'response', () => clockNow);
    assert.equal(db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state, 'held');
    await processNotionTaskAction(db, client, 'response', options);
    assert.equal(writes, 1);
    found = true;
    await reconcileNotionTaskComment(db, client, 'response', () => clockNow);
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'held',
      'another author cannot impersonate a confirmed operation',
    );
    authentic = true;
    await reconcileNotionTaskComment(db, client, 'response', () => clockNow);
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'confirmed',
    );
    assert.equal(writes, 1);
  } finally {
    db.raw.close();
  }
});
void test('a membership rate limit before a Notion effect remains safely retryable', async () => {
  const { processNotionTaskAction } = await actions();
  const { DiscordApiFailure } = await import('../src/discord-types');
  const db = await fixture();
  let requests = 0;
  try {
    const notion = new NotionTaskClient('token', () => {
      requests++;
      return Promise.resolve(Response.json(page()));
    });
    await processNotionTaskAction(db, notion, 'response', {
      clock: () => now,
      membership: () => Promise.reject(new DiscordApiFailure('rate_limited', 120000)),
    });
    assert.equal(requests, 0);
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'retryable',
    );
    assert.equal(
      db.raw.prepare('SELECT next_attempt_at FROM task_checkin_operations').get()?.next_attempt_at,
      '2026-10-20T16:02:00.000Z',
    );
  } finally {
    db.raw.close();
  }
});

void test('status selections write the chosen status once and reject unknown statuses', async () => {
  const { processNotionTaskAction } = await actions();
  for (const status of ['Not started', 'In progress', 'Done', 'Unexpected']) {
    const db = await fixture('complete');
    db.raw
      .prepare("UPDATE task_checkin_operations SET payload_json=? WHERE id='response'")
      .run(JSON.stringify({ status }));
    let writes = 0;
    const client = new NotionTaskClient('token', (_url, init) => {
      const raw = page();
      if (init?.method === 'PATCH') {
        writes++;
        assert.ok(typeof init.body === 'string');
        assert.deepEqual(JSON.parse(init.body), {
          properties: { Status: { status: { name: status } } },
        });
        raw.properties.Status.status.name = status;
      }
      return Promise.resolve(Response.json(raw));
    });
    try {
      const options = { membership: () => Promise.resolve(true), clock: () => now };
      await processNotionTaskAction(db, client, 'response', options);
      await processNotionTaskAction(db, client, 'response', options);
      const valid = status !== 'Unexpected';
      assert.equal(writes, valid ? 1 : 0);
      assert.equal(
        db.raw.prepare("SELECT state FROM task_checkin_operations WHERE id='response'").get()
          ?.state,
        valid ? 'confirmed' : 'failed',
      );
    } finally {
      db.raw.close();
    }
  }
});
