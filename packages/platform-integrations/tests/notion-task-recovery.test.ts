import assert from 'node:assert/strict';
import test from 'node:test';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { requestTaskCommentRecovery } from '@lasvegasfortransit/platform-storage/notion-task-recovery';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import { NotionTaskClient } from '../src/notion-task-client';
import { fixture, now, sourceId, pageId } from './support/task-action-fixture';
async function setup() {
  const db = await fixture();
  for (const id of ['staff', 'backup']) {
    db.raw
      .prepare(
        "INSERT INTO people(id,membership_status,created_at,updated_at) VALUES(?,'member',?,?)",
      )
      .run(id, now.toISOString(), now.toISOString());
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,'staff',?)",
      )
      .run(id, now.toISOString());
  }
  const actor = await loadActor(db, 'staff');
  assert.ok(actor);
  db.raw
    .prepare("UPDATE task_checkin_operations SET state='held',reason='unconfirmed_effect'")
    .run();
  await requestTaskCommentRecovery(
    db,
    actor,
    { sourceId, operationId: 'response', expectedUpdatedAt: now.toISOString() },
    now,
  );
  const api = await import('../src/notion-task-recovery').catch(() => null);
  assert.ok(api, 'scheduled read-only recovery processor must exist');
  return { db, api };
}
function provider(author: string | null, onRead = () => {}) {
  let reads = 0;
  const client = new NotionTaskClient('token', (input, init) => {
    assert.equal(init?.method, 'GET', 'recovery must never post another comment');
    reads++;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/users/me'))
      return Promise.resolve(Response.json({ object: 'user', id: 'integration-bot', type: 'bot' }));
    assert.ok(url.includes('/comments?'));
    onRead();
    return Promise.resolve(
      Response.json({
        results: author
          ? [
              {
                object: 'comment',
                id: 'matching-comment',
                created_by: { id: author },
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
  });
  return { client, reads: () => reads };
}
void test('a recovery check confirms only a positive integration-authored reference and never repeats a write', async () => {
  const f = await setup();
  try {
    const notion = provider('integration-bot'),
      budget = queryBudget(f.db, 50);
    assert.equal(
      (await f.api.processTaskCommentRecovery(budget.db, notion.client, sourceId, () => now)).kind,
      'progress',
    );
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'confirmed',
    );
    assert.equal(notion.reads(), 2);
    assert.ok(budget.queries <= 50);
    assert.equal(
      (await f.api.processTaskCommentRecovery(budget.db, notion.client, sourceId, () => now)).kind,
      'idle',
    );
    assert.equal(notion.reads(), 2);
  } finally {
    f.db.raw.close();
  }
});
for (const author of [null, 'another-person'])
  void test(`unresolved-only absence or wrong author stays unconfirmed: ${author}`, async () => {
    const f = await setup();
    try {
      await f.api.processTaskCommentRecovery(f.db, provider(author).client, sourceId, () => now);
      assert.equal(
        f.db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
        'held',
      );
      assert.equal(
        f.db.raw.prepare('SELECT reason FROM task_checkin_recovery').get()?.reason,
        'not_confirmed',
      );
    } finally {
      f.db.raw.close();
    }
  });
void test('administrator revocation during a provider read cannot confirm the held update', async () => {
  const f = await setup();
  try {
    const notion = provider('integration-bot', () =>
      f.db.raw.prepare("DELETE FROM staff_administrators WHERE person_id='staff'").run(),
    );
    await f.api.processTaskCommentRecovery(f.db, notion.client, sourceId, () => now);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'held',
    );
  } finally {
    f.db.raw.close();
  }
});

void test('recovery respects the provider retry delay instead of checking again too early', async () => {
  const f = await setup();
  try {
    let calls = 0;
    const notion = new NotionTaskClient('token', () => {
      calls++;
      return Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '300' } }));
    });
    await f.api.processTaskCommentRecovery(f.db, notion, sourceId, () => now);
    const queued = f.db.raw
      .prepare('SELECT state,next_attempt_at FROM task_checkin_recovery')
      .get();
    assert.equal(queued?.state, 'queued');
    assert.ok(new Date(String(queued.next_attempt_at)).getTime() >= now.getTime() + 300_000);
    assert.equal(
      (
        await f.api.processTaskCommentRecovery(
          f.db,
          notion,
          sourceId,
          () => new Date(now.getTime() + 120_000),
        )
      ).kind,
      'idle',
    );
    assert.equal(calls, 1);
  } finally {
    f.db.raw.close();
  }
});
