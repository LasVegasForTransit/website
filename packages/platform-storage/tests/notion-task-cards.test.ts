import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import {
  saveTaskCheckinSource,
  putNotionTaskMapping,
  upsertNotionTaskSnapshot,
  setTaskCheckinConsent,
} from '../src/notion-task-checkins';

const now = new Date('2026-10-20T16:00:00Z');
async function cards() {
  const module = await import('../src/notion-task-cards').catch(() => null);
  assert.ok(module, 'private card references must be durable');
  return module;
}
async function fixture() {
  const db = memoryDb();
  db.raw
    .prepare("INSERT INTO people(id,created_at,updated_at) VALUES('member',?,?)")
    .run(now.toISOString(), now.toISOString());
  db.raw
    .prepare(
      `INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
    VALUES('discord','member','discord','111111111111111111',?,'self_linked',?,?)`,
    )
    .run(now.toISOString(), now.toISOString(), now.toISOString());
  await saveTaskCheckinSource(
    db,
    {
      sourceId: 'source',
      workspaceId: 'workspace',
      expectedRevision: 0,
      enabled: true,
      policy: { cohortPersonIds: ['member'] },
      actorId: 'member',
    },
    now,
  );
  await putNotionTaskMapping(
    db,
    {
      workspaceId: 'workspace',
      notionUserId: 'notion-member',
      personId: 'member',
      confirmedBy: 'member',
    },
    now,
  );
  await upsertNotionTaskSnapshot(
    db,
    {
      sourceId: 'source',
      taskId: 'task',
      revision: 'v1',
      active: true,
      sourceEditedAt: now.toISOString(),
      snapshot: { assigneeIds: ['notion-member'], title: 'Task' },
    },
    now,
  );
  await setTaskCheckinConsent(
    db,
    {
      sourceId: 'source',
      personId: 'member',
      discordUserId: '111111111111111111',
      interactionId: '100000000000000001',
      state: 'active',
      policyRevision: 1,
    },
    now,
  );
  return db;
}
void test('private card tokens stay stable for a task version and reject different Discord actors', async () => {
  const s = await cards(),
    db = await fixture();
  try {
    const input = { sourceId: 'source', taskId: 'task', personId: 'member' };
    const card = await s.ensureTaskCard(db, input, now);
    assert.ok(card);
    assert.match(card.token, /^[\w-]{43}$/);
    assert.equal((await s.ensureTaskCard(db, input, now))?.token, card.token);
    assert.equal(
      await s.readTaskCard(db, { token: card.token, discordUserId: '222222222222222222' }),
      null,
    );
    assert.equal(
      (await s.readTaskCard(db, { token: card.token, discordUserId: '111111111111111111' }))
        ?.actionable,
      1,
    );
  } finally {
    db.raw.close();
  }
});
void test('changed task versions make old controls stale and regenerate the opaque reference', async () => {
  const s = await cards(),
    db = await fixture();
  try {
    const input = { sourceId: 'source', taskId: 'task', personId: 'member' };
    const card = await s.ensureTaskCard(db, input, now);
    assert.ok(card);
    await upsertNotionTaskSnapshot(
      db,
      {
        sourceId: 'source',
        taskId: 'task',
        revision: 'v2',
        active: true,
        sourceEditedAt: now.toISOString(),
        snapshot: { assigneeIds: ['notion-member'], title: 'Changed' },
      },
      now,
    );
    assert.equal(
      (await s.readTaskCard(db, { token: card.token, discordUserId: '111111111111111111' }))
        ?.actionable,
      0,
    );
    const current = await s.ensureTaskCard(db, input, now);
    assert.ok(current);
    assert.notEqual(current.token, card.token);
    const retired = await s.readTaskCard(db, {
      token: card.token,
      discordUserId: '111111111111111111',
    });
    assert.ok(retired, 'the owner can recognize a retired control');
    assert.equal(retired.actionable, 0);
    assert.equal(retired.retired, 1);
    assert.equal(retired.token, card.token);
    assert.equal(
      await s.readTaskCard(db, { token: card.token, discordUserId: '222222222222222222' }),
      null,
    );
    db.raw
      .prepare(
        "INSERT INTO discord_disconnects(identity_record_id,operation_id,requested_at) VALUES('discord','disconnect',?)",
      )
      .run(now.toISOString());
    assert.equal(
      await s.readTaskCard(db, { token: card.token, discordUserId: '111111111111111111' }),
      null,
    );
    db.raw.prepare('DELETE FROM task_checkin_cards').run();
    assert.equal(
      await s.readTaskCard(db, { token: card.token, discordUserId: '111111111111111111' }),
      null,
    );
  } finally {
    db.raw.close();
  }
});
void test('card delivery stays unavailable without current consent or cohort membership', async () => {
  const s = await cards(),
    db = await fixture();
  try {
    await setTaskCheckinConsent(
      db,
      {
        sourceId: 'source',
        personId: 'member',
        discordUserId: '111111111111111111',
        interactionId: '100000000000000100',
        state: 'paused',
        policyRevision: 1,
      },
      now,
    );
    assert.equal(
      await s.ensureTaskCard(db, { sourceId: 'source', taskId: 'task', personId: 'member' }, now),
      null,
    );
    await saveTaskCheckinSource(
      db,
      {
        sourceId: 'source',
        workspaceId: 'workspace',
        expectedRevision: 1,
        enabled: true,
        policy: { cohortPersonIds: [] },
        actorId: 'member',
      },
      now,
    );
    await setTaskCheckinConsent(
      db,
      {
        sourceId: 'source',
        personId: 'member',
        discordUserId: '111111111111111111',
        interactionId: '100000000000000200',
        state: 'active',
        policyRevision: 2,
      },
      now,
    );
    assert.equal(
      await s.ensureTaskCard(db, { sourceId: 'source', taskId: 'task', personId: 'member' }, now),
      null,
    );
  } finally {
    db.raw.close();
  }
});
