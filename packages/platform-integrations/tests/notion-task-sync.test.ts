import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import {
  saveTaskCheckinSource,
  upsertNotionTaskSnapshot,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { NotionTaskClient } from '../src/notion-task-client';

const sourceId = '10000000-0000-4000-8000-000000000001';
const pageId = '10000000-0000-4000-8000-000000000002';
const now = new Date('2026-10-20T16:00:00Z');
const policy = {
  shareDescription: false,
  rangeBoundary: 'reject',
  fields: {
    name: 'Task name',
    description: 'Description',
    assignee: 'Assignee',
    due: 'Due date',
    status: 'Status',
    project: 'Project',
  },
};
function page(people: { id: string }[] = [{ id: 'guest-user' }]) {
  return {
    object: 'page',
    id: pageId,
    parent: { data_source_id: sourceId },
    last_edited_time: now.toISOString(),
    url: `https://www.notion.so/${pageId}`,
    properties: {
      'Task name': { title: [{ plain_text: 'Current task' }] },
      Assignee: { id: 'people', people },
      'Due date': { date: { start: '2026-10-23' } },
      Status: { status: { name: 'In progress' } },
      Project: { relation: [] },
    },
  };
}
async function fixture() {
  const db = memoryDb();
  db.raw
    .prepare("INSERT INTO people(id,created_at,updated_at) VALUES('staff',?,?)")
    .run(now.toISOString(), now.toISOString());
  await saveTaskCheckinSource(
    db,
    {
      sourceId,
      workspaceId: 'workspace',
      expectedRevision: 0,
      policy,
      enabled: false,
      actorId: 'staff',
    },
    now,
  );
  await upsertNotionTaskSnapshot(
    db,
    {
      sourceId,
      taskId: 'existing',
      revision: 'old',
      sourceEditedAt: now.toISOString(),
      active: true,
      snapshot: { title: 'Existing', assigneeIds: ['old-assignee'] },
    },
    now,
  );
  return db;
}
async function sync() {
  const module = await import('../src/notion-task-sync').catch(() => null);
  assert.ok(module, 'the bounded source synchronizer must exist');
  return module.syncNotionTaskPage;
}

void test('synchronization saves separate pages and only removes absent tasks after complete reconciliation', async () => {
  const synchronize = await sync();
  const db = await fixture();
  let calls = 0,
    clockNow = now;
  const client = new NotionTaskClient(
    'fixture-token',
    () => {
      calls++;
      if (calls === 2) return Promise.resolve(new Response(null, { status: 503 }));
      return Promise.resolve(
        Response.json({
          results: calls === 1 ? [page()] : [],
          has_more: calls === 1,
          next_cursor: calls === 1 ? 'next' : null,
        }),
      );
    },
    { maxRequests: 100, deadline: now.getTime() + 3600000, clock: () => clockNow },
  );
  try {
    assert.equal((await synchronize(db, client, sourceId, () => now)).kind, 'scanned');
    assert.equal((await synchronize(db, client, sourceId, () => now)).kind, 'failed');
    assert.equal(
      db.raw.prepare("SELECT active FROM task_checkin_tasks WHERE task_id='existing'").get()
        ?.active,
      1,
    );
    const later = new Date(now.getTime() + 60_000);
    clockNow = later;
    const result = await synchronize(db, client, sourceId, () => later);
    assert.equal(result.kind, 'scanned');
    assert.equal(
      db.raw.prepare("SELECT active FROM task_checkin_tasks WHERE task_id='existing'").get()
        ?.active,
      0,
    );
    assert.equal(
      db.raw.prepare('SELECT active FROM task_checkin_tasks WHERE task_id=?').get(pageId)?.active,
      1,
    );
  } finally {
    db.raw.close();
  }
});

void test('complete people property pagination retains all assignees without saving profiles', async () => {
  const synchronize = await sync();
  const db = await fixture();
  const first25 = Array.from({ length: 25 }, (_, i) => ({ id: `guest-${i}` }));
  const client = new NotionTaskClient('fixture-token', (input) => {
    if (
      (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).includes(
        '/query',
      )
    )
      return Promise.resolve(
        Response.json({ results: [page(first25)], has_more: false, next_cursor: null }),
      );
    if (
      (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).includes(
        'start_cursor',
      )
    )
      return Promise.resolve(
        Response.json({
          results: [
            {
              type: 'people',
              people: {
                id: 'last-guest',
                name: 'Guest Contributor',
                person: { email: 'PRIVATE-GUEST-ADDRESS' },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );
    return Promise.resolve(
      Response.json({
        results: first25.map((person) => ({ type: 'people', people: person })),
        has_more: true,
        next_cursor: 'last',
      }),
    );
  });
  try {
    assert.equal((await synchronize(db, client, sourceId, () => now)).kind, 'scanned');
    const row = db.raw
      .prepare('SELECT snapshot_json FROM task_checkin_tasks WHERE task_id=?')
      .get(pageId);
    const snapshot = JSON.parse(String(row?.snapshot_json)) as {
      assigneeIds: string[];
      assigneeLabels: { id: string; name: string }[];
    };
    assert.equal(snapshot.assigneeIds.length, 26);
    assert.ok(snapshot.assigneeIds.includes('last-guest'));
    assert.deepEqual(snapshot.assigneeLabels, [{ id: 'last-guest', name: 'Guest Contributor' }]);
    assert.equal(String(row?.snapshot_json).includes('PRIVATE-GUEST-ADDRESS'), false);
  } finally {
    db.raw.close();
  }
});

void test('escalation follows the configured project source and keeps only lead IDs', async () => {
  const synchronize = await sync();
  const db = await fixture();
  const projectSource = '10000000-0000-4000-8000-000000000003';
  const projectId = '10000000-0000-4000-8000-000000000004';
  await saveTaskCheckinSource(
    db,
    {
      sourceId,
      workspaceId: 'workspace',
      expectedRevision: 1,
      enabled: false,
      actorId: 'staff',
      policy: { ...policy, projectsSourceId: projectSource, projectLeadField: 'Lead' },
    },
    now,
  );
  const task = page();
  const raw = {
    ...task,
    properties: { ...task.properties, Project: { relation: [{ id: projectId }] } },
  };
  const client = new NotionTaskClient('fixture-token', (input) =>
    Promise.resolve(
      Response.json(
        (typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
        ).includes('/query')
          ? { results: [raw], has_more: false, next_cursor: null }
          : {
              object: 'page',
              id: projectId,
              parent: { data_source_id: projectSource },
              properties: {
                Lead: { people: [{ id: 'leader-id', name: 'PRIVATE-LEADER-NAME' }] },
              },
            },
      ),
    ),
  );
  try {
    assert.equal((await synchronize(db, client, sourceId, () => now)).kind, 'scanned');
    const row = db.raw
      .prepare('SELECT snapshot_json FROM task_checkin_tasks WHERE task_id=?')
      .get(pageId);
    const snapshot = JSON.parse(String(row?.snapshot_json)) as {
      escalationNotionIds: string[];
      escalationNeedsReview: boolean;
    };
    assert.deepEqual(snapshot.escalationNotionIds, ['leader-id']);
    assert.equal(snapshot.escalationNeedsReview, false);
    assert.equal(String(row?.snapshot_json).includes('PRIVATE-LEADER-NAME'), false);
  } finally {
    db.raw.close();
  }
});

void test('a policy change between configuration read and scan claim cannot use stale field rules', async () => {
  const synchronize = await sync();
  const db = await fixture();
  let changed = false;
  const clock = () => {
    if (!changed) {
      changed = true;
      db.raw
        .prepare('UPDATE task_checkin_sources SET revision=revision+1,policy_json=? WHERE id=?')
        .run(
          JSON.stringify({ ...policy, fields: { ...policy.fields, name: 'New name' } }),
          sourceId,
        );
    }
    return now;
  };
  const client = new NotionTaskClient('fixture-token', () =>
    Promise.resolve(Response.json({ results: [page()], has_more: false, next_cursor: null })),
  );
  try {
    assert.equal((await synchronize(db, client, sourceId, clock)).kind, 'stale');
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM task_checkin_tasks WHERE task_id=?').get(pageId)?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});
