import assert from 'node:assert/strict';
import test from 'node:test';
import { page, sourceId, now } from './support/task-action-fixture';
import { taskPolicy } from './support/task-checkins';
import { NotionTaskClient } from '../src/notion-task-client';
import { ready, providers } from './support/task-escalation-fixture';
async function projectFixture() {
  const db = await ready(),
    projectId = taskPolicy.projectsSourceId;
  const initial = page(),
    raw = {
      ...initial,
      properties: { ...initial.properties, Project: { relation: [{ id: projectId }] } },
    };
  const { parseNotionTaskPage } = await import('../src/notion-task-reader');
  const { putNotionTaskMapping } =
    await import('@lasvegasfortransit/platform-storage/notion-task-checkins');
  db.raw
    .prepare('UPDATE task_checkin_sources SET policy_json=?')
    .run(JSON.stringify({ ...taskPolicy, cohortPersonIds: ['member', 'support'] }));
  const parsed = parseNotionTaskPage(raw, { ...taskPolicy, sourceId, rangeBoundary: 'reject' });
  assert.ok(parsed);
  db.raw
    .prepare('UPDATE task_checkin_tasks SET snapshot_json=?')
    .run(JSON.stringify(parsed.snapshot));
  await putNotionTaskMapping(
    db,
    {
      workspaceId: 'workspace',
      notionUserId: 'notion-support',
      personId: 'support',
      confirmedBy: 'member',
    },
    now,
  );
  const project = {
    object: 'page',
    id: projectId,
    parent: { data_source_id: projectId },
    properties: { Lead: { people: [{ id: 'notion-support' }] } },
  };
  return { db, projectId, raw, project };
}
void test('a failed project read becomes durable staff review, honors Retry-After and recovers without another volunteer response', async () => {
  const api = await import('../src/notion-task-escalations');
  const { db, projectId, raw, project } = await projectFixture(),
    p = providers();
  let recovered = false,
    reads = 0,
    clockNow = now;
  const notion = new NotionTaskClient(
    'fixture',
    (url) => {
      reads++;
      if (!recovered)
        return Promise.resolve(
          new Response('private provider error', {
            status: 503,
            headers: { 'Retry-After': '300' },
          }),
        );
      assert.ok(typeof url === 'string');
      return Promise.resolve(Response.json(url.endsWith(projectId) ? project : raw));
    },
    { maxRequests: 20, deadline: now.getTime() + 3600000, clock: () => clockNow },
  );
  try {
    await api.queueTaskEscalations(db, notion, sourceId, () => now);
    const review = db.raw
      .prepare('SELECT state,reason,next_attempt_at FROM task_checkin_escalations')
      .get();
    assert.equal(review?.state, 'review');
    assert.equal(review.reason, 'routing_provider_unavailable');
    assert.equal(review.next_attempt_at, new Date(now.getTime() + 300000).toISOString());
    recovered = true;
    await api.queueTaskEscalations(db, notion, sourceId, () => new Date(now.getTime() + 299000));
    assert.equal(reads, 1, 'a routing check must respect the provider cooldown');
    const later = new Date(now.getTime() + 300000);
    clockNow = later;
    await api.queueTaskEscalations(db, notion, sourceId, () => later);
    await api.processTaskEscalation(db, { notion, discord: p.discord }, sourceId, () => later);
    assert.equal(p.sent.length, 1);
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM task_checkin_escalations WHERE state='review'")
        .get()?.n,
      0,
    );
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM task_checkin_escalations WHERE state='confirmed'")
        .get()?.n,
      1,
    );
    assert.equal(
      JSON.stringify(db.raw.prepare('SELECT * FROM task_checkin_escalations').all()).includes(
        'private provider error',
      ),
      false,
    );
  } finally {
    db.raw.close();
  }
});
void test('a routing request budget limit produces a visible safe review without sending or spinning', async () => {
  const api = await import('../src/notion-task-escalations');
  const { db } = await projectFixture();
  let reads = 0;
  const notion = new NotionTaskClient(
    'fixture',
    () => {
      reads++;
      return Promise.resolve(Response.json(page()));
    },
    { maxRequests: 0, deadline: now.getTime() + 40000, clock: () => now },
  );
  try {
    await api.queueTaskEscalations(db, notion, sourceId, () => now);
    assert.equal(reads, 0);
    const row = db.raw.prepare('SELECT state,reason FROM task_checkin_escalations').get();
    assert.equal(row?.state, 'review');
    assert.equal(row.reason, 'routing_limit');
    await api.queueTaskEscalations(db, notion, sourceId, () => new Date(now.getTime() + 1000));
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM task_checkin_escalations').get()?.n, 1);
  } finally {
    db.raw.close();
  }
});
