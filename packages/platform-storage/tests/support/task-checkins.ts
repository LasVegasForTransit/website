import assert from 'node:assert/strict';
import { memoryDb } from './db';

export const now = new Date('2026-10-20T16:00:00Z');
export const later = new Date('2026-10-20T16:02:00Z');
export async function storage() {
  const module = await import('../../src/notion-task-checkins').catch(() => null);
  assert.ok(module, 'durable task check-in storage must be available');
  return module;
}
export function fixture() {
  const db = memoryDb();
  for (const id of ['staff', 'member', 'guest']) {
    db.raw
      .prepare('INSERT INTO people(id,created_at,updated_at) VALUES(?,?,?)')
      .run(id, now.toISOString(), now.toISOString());
  }
  db.raw
    .prepare(
      `INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
    VALUES('discord-member','member','discord','111111111111111111',?,'self_linked',?,?)`,
    )
    .run(now.toISOString(), now.toISOString(), now.toISOString());
  return db;
}
export async function ready() {
  const s = await storage();
  const db = fixture();
  await s.saveTaskCheckinSource(
    db,
    {
      sourceId: 'source',
      workspaceId: 'workspace',
      expectedRevision: 0,
      enabled: true,
      policy: { timezone: 'America/Los_Angeles', cohortPersonIds: ['member'] },
      actorId: 'staff',
    },
    now,
  );
  await s.putNotionTaskMapping(
    db,
    {
      workspaceId: 'workspace',
      notionUserId: 'notion-member',
      personId: 'member',
      confirmedBy: 'staff',
    },
    now,
  );
  await s.upsertNotionTaskSnapshot(
    db,
    {
      sourceId: 'source',
      taskId: 'task',
      revision: 'v1',
      sourceEditedAt: now.toISOString(),
      active: true,
      snapshot: { name: 'Prepare agenda', assigneeIds: ['notion-member'] },
    },
    now,
  );
  assert.equal(
    await s.setTaskCheckinConsent(
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
    ),
    true,
  );
  return { s, db };
}
export const operation = {
  id: 'operation',
  sourceId: 'source',
  taskId: 'task',
  personId: 'member',
  taskRevision: 'v1',
  consentRevision: 1,
  policyRevision: 1,
  kind: 'progress' as const,
  payload: { text: 'Draft ready' },
};
