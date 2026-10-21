import assert from 'node:assert/strict';
import test from 'node:test';
import { page, sourceId, now } from './support/task-action-fixture';
import { taskPolicy } from './support/task-checkins';
import { NotionTaskClient } from '../src/notion-task-client';
import { ready, providers } from './support/task-escalation-fixture';
void test('a confirmed blocker reaches an independently opted-in support person once, with native private content', async () => {
  const api = await import('../src/notion-task-escalations').catch(() => null);
  assert.ok(api);
  const db = await ready(),
    p = providers();
  try {
    await api.queueTaskEscalations(db, p.notion, sourceId, () => now);
    await api.queueTaskEscalations(db, p.notion, sourceId, () => now);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM task_checkin_escalations').get()?.n, 1);
    await api.processTaskEscalation(db, p, sourceId, () => now);
    await api.processTaskEscalation(db, p, sourceId, () => now);
    assert.equal(
      p.sent.length,
      1,
      JSON.stringify(db.raw.prepare('SELECT state,reason FROM task_checkin_escalations').all()),
    );
    assert.match(p.sent[0] ?? '', /Finish agenda/);
    assert.match(p.sent[0] ?? '', /Need help/);
    assert.equal((p.sent[0] ?? '').includes('@everyone'), false);
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_escalations').get()?.state,
      'confirmed',
    );
    assert.equal(
      db.raw.prepare('SELECT person_id FROM task_checkin_notifications').get()?.person_id,
      'support',
    );
    db.raw.prepare("UPDATE task_checkin_tasks SET revision='v2'").run();
    await api.queueTaskEscalations(db, p.notion, sourceId, () => now);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM task_checkin_escalations').get()?.n,
      1,
      'a source refresh must not create another copy of the same help request',
    );
  } finally {
    db.raw.close();
  }
});
void test('revocation during DM creation prevents escalation details from being sent', async () => {
  const api = await import('../src/notion-task-escalations').catch(() => null);
  assert.ok(api);
  const db = await ready(),
    p = providers((url) => {
      if (url.endsWith('/users/@me/channels'))
        db.raw
          .prepare("UPDATE task_checkin_consents SET state='paused' WHERE person_id='support'")
          .run();
    });
  try {
    await api.queueTaskEscalations(db, p.notion, sourceId, () => now);
    await api.processTaskEscalation(db, p, sourceId, () => now);
    assert.equal(p.sent.length, 0);
  } finally {
    db.raw.close();
  }
});
void test('unmapped leads become administrator review, and overdue routing waits for its explicit threshold', async () => {
  const api = await import('../src/notion-task-escalations').catch(() => null);
  assert.ok(api);
  const db = await ready(),
    p = providers();
  try {
    db.raw.prepare('DELETE FROM task_checkin_operations').run();
    await api.queueTaskEscalations(db, p.notion, sourceId, () => now);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM task_checkin_escalations').get()?.n, 0);
    db.raw
      .prepare('UPDATE task_checkin_sources SET policy_json=?')
      .run(JSON.stringify({ ...taskPolicy, cohortPersonIds: ['member', 'support'] }));
    await api.queueTaskEscalations(db, p.notion, sourceId, () => new Date('2026-10-27T18:00:00Z'));
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_escalations').get()?.state,
      'review',
    );
    await api.processTaskEscalation(db, p, sourceId, () => new Date('2026-10-27T18:00:00Z'));
    assert.equal(p.sent.length, 0);
  } finally {
    db.raw.close();
  }
});
void test('a changed Notion project lead is rechecked instead of receiving stale blocker content', async () => {
  const api = await import('../src/notion-task-escalations');
  const { putNotionTaskMapping } =
    await import('@lasvegasfortransit/platform-storage/notion-task-checkins');
  const { parseNotionTaskPage } = await import('../src/notion-task-reader');
  const db = await ready(),
    p = providers(),
    projectId = '10000000-0000-4000-8000-000000000003';
  let lead = 'notion-support',
    projectReads = 0;
  const original = page(),
    raw = {
      ...original,
      properties: { ...original.properties, Project: { relation: [{ id: projectId }] } },
    };
  const notion = new NotionTaskClient('fixture', (url) => {
    if (typeof url === 'string' && url.endsWith(projectId)) {
      projectReads++;
      return Promise.resolve(
        Response.json({
          object: 'page',
          id: projectId,
          parent: { data_source_id: projectId },
          properties: { Lead: { people: [{ id: lead }] } },
        }),
      );
    }
    return Promise.resolve(Response.json(raw));
  });
  try {
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
    await api.queueTaskEscalations(db, notion, sourceId, () => now);
    lead = 'notion-new-lead';
    await api.processTaskEscalation(db, { notion, discord: p.discord }, sourceId, () => now);
    assert.equal(p.sent.length, 0);
    assert.ok(projectReads >= 2);
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_escalations').get()?.state,
      'review',
    );
  } finally {
    db.raw.close();
  }
});
void test('support notifications share caps and uncertain message creates are held without reposting', async () => {
  const api = await import('../src/notion-task-escalations');
  const db = await ready();
  let creates = 0;
  const p = providers((url) => {
    if (url.endsWith('/messages')) {
      creates++;
      throw new Error('uncertain fixture transport');
    }
  });
  try {
    await api.queueTaskEscalations(db, p.notion, sourceId, () => now);
    db.raw
      .prepare(
        "INSERT INTO task_checkin_notifications(kind,operation_id,source_id,person_id,reserved_at) VALUES('digest','prior',?,'support',?)",
      )
      .run(sourceId, now.toISOString());
    await api.processTaskEscalation(db, p, sourceId, () => now);
    assert.equal(creates, 0);
    assert.equal(
      db.raw.prepare('SELECT attempts FROM task_checkin_escalations').get()?.attempts,
      0,
    );
    const later = new Date(now.getTime() + 3_600_000);
    await api.processTaskEscalation(db, p, sourceId, () => later);
    await api.queueTaskEscalations(db, p.notion, sourceId, () => later);
    await api.processTaskEscalation(db, p, sourceId, () => later);
    assert.equal(creates, 1);
    assert.equal(db.raw.prepare('SELECT state FROM task_checkin_escalations').get()?.state, 'held');
  } finally {
    db.raw.close();
  }
});
void test('a vanished configured support record does not prevent delivery to the other recipients', async () => {
  const api = await import('../src/notion-task-escalations');
  const db = await ready(),
    p = providers();
  try {
    db.raw
      .prepare(
        'UPDATE task_checkin_sources SET policy_json=json_set(policy_json,\'$.supportPersonIds\',json(\'["support","missing"]\'))',
      )
      .run();
    await api.queueTaskEscalations(db, p.notion, sourceId, () => now);
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM task_checkin_escalations WHERE state='review'")
        .get()?.n,
      1,
    );
    await api.processTaskEscalation(db, p, sourceId, () => now);
    assert.equal(p.sent.length, 1);
  } finally {
    db.raw.close();
  }
});
void test('three candidates and a support delivery fit the shared 50-query allowance', async () => {
  const api = await import('../src/notion-task-escalations');
  const { queryBudget } = await import('@lasvegasfortransit/platform-storage/query-budget');
  const { discordRateLimit } = await import('../src/discord-rate-limit');
  const { parseNotionTaskPage } = await import('../src/notion-task-reader');
  const { upsertNotionTaskSnapshot } =
    await import('@lasvegasfortransit/platform-storage/notion-task-checkins');
  const db = await ready(),
    at = new Date('2026-10-27T18:00:00Z');
  try {
    for (const id of [
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000005',
    ]) {
      const parsed = parseNotionTaskPage(
        { ...page(), id, url: `https://www.notion.so/${id}` },
        { ...taskPolicy, sourceId, rangeBoundary: 'reject' },
      );
      assert.ok(parsed);
      await upsertNotionTaskSnapshot(
        db,
        {
          sourceId,
          taskId: id,
          revision: 'extra',
          sourceEditedAt: now.toISOString(),
          active: true,
          snapshot: parsed.snapshot,
        },
        now,
      );
    }
    const budget = queryBudget(db, 50),
      p = providers(
        undefined,
        discordRateLimit(budget.db, taskPolicy.guildId, () => at),
      );
    const notion = new NotionTaskClient('fixture', (url) => {
      assert.ok(typeof url === 'string');
      const id = url.split('/').at(-1);
      return Promise.resolve(Response.json({ ...page(), id, url: `https://www.notion.so/${id}` }));
    });
    await api.queueTaskEscalations(budget.db, notion, sourceId, () => at);
    await api.processTaskEscalation(budget.db, { notion, discord: p.discord }, sourceId, () => at);
    assert.equal(p.sent.length, 1);
    assert.ok(budget.queries <= 50);
  } finally {
    db.raw.close();
  }
});
void test('overdue support waits through assignee snooze and quiet hours without using up retries', async () => {
  const api = await import('../src/notion-task-escalations');
  const db = await ready(),
    p = providers(),
    at = new Date('2026-10-27T18:00:00Z');
  try {
    db.raw.prepare('DELETE FROM task_checkin_operations').run();
    db.raw
      .prepare('UPDATE task_checkin_cards SET snoozed_until=?')
      .run(new Date(at.getTime() + 3600000).toISOString());
    await api.queueTaskEscalations(db, p.notion, sourceId, () => at);
    await api.processTaskEscalation(db, p, sourceId, () => at);
    assert.equal(p.sent.length, 0);
    assert.equal(
      db.raw.prepare('SELECT attempts FROM task_checkin_escalations').get()?.attempts,
      0,
    );
    await api.processTaskEscalation(db, p, sourceId, () => new Date('2026-10-28T06:00:00Z'));
    assert.equal(p.sent.length, 0);
    assert.equal(
      db.raw.prepare('SELECT attempts FROM task_checkin_escalations').get()?.attempts,
      0,
    );
    await api.processTaskEscalation(db, p, sourceId, () => new Date('2026-10-28T18:00:00Z'));
    assert.equal(p.sent.length, 1);
    assert.match(p.sent[0] ?? '', /overdue task/);
  } finally {
    db.raw.close();
  }
});
