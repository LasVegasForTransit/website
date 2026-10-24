import assert from 'node:assert/strict';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import {
  saveTaskCheckinSource,
  putNotionTaskMapping,
  setTaskCheckinConsent,
  upsertNotionTaskSnapshot,
  recordTaskInteraction,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { ensureTaskCard } from '@lasvegasfortransit/platform-storage/notion-task-cards';
import { taskPolicy } from './task-checkins';
import { parseNotionTaskPage } from '../../src/notion-task-reader';
export const sourceId = '10000000-0000-4000-8000-000000000001';
export const pageId = '10000000-0000-4000-8000-000000000002';
export const now = new Date('2026-10-20T16:00:00Z');
export function page() {
  return {
    object: 'page',
    id: pageId,
    parent: { data_source_id: sourceId },
    last_edited_time: now.toISOString(),
    url: `https://www.notion.so/${pageId}`,
    properties: {
      'Task name': { title: [{ plain_text: 'Finish agenda' }] },
      Assignee: { people: [{ id: 'notion-member' }] },
      'Due date': { date: { start: '2026-10-23' } },
      Status: { status: { name: 'In progress' } },
      Project: { relation: [] },
    },
  };
}
export async function fixture(
  kind: 'progress' | 'blocker' | 'extension' | 'complete' | 'snooze' = 'progress',
) {
  const db = memoryDb();
  db.raw
    .prepare("INSERT INTO people(id,created_at,updated_at) VALUES('member',?,?)")
    .run(now.toISOString(), now.toISOString());
  db.raw
    .prepare(
      "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('discord','member','discord','111111111111111111',?,'self_linked',?,?)",
    )
    .run(now.toISOString(), now.toISOString(), now.toISOString());
  await saveTaskCheckinSource(
    db,
    {
      sourceId,
      workspaceId: 'workspace',
      expectedRevision: 0,
      enabled: true,
      policy: taskPolicy,
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
  await setTaskCheckinConsent(
    db,
    {
      sourceId,
      personId: 'member',
      discordUserId: '111111111111111111',
      interactionId: '100000000000000001',
      state: 'active',
      policyRevision: 1,
    },
    now,
  );
  const parsed = parseNotionTaskPage(page(), { ...taskPolicy, rangeBoundary: 'reject', sourceId });
  assert.ok(parsed);
  await upsertNotionTaskSnapshot(
    db,
    {
      sourceId,
      taskId: pageId,
      revision: 'v1',
      sourceEditedAt: now.toISOString(),
      active: true,
      snapshot: parsed.snapshot,
    },
    now,
  );
  await ensureTaskCard(db, { sourceId, taskId: pageId, personId: 'member' }, now);
  await recordTaskInteraction(
    db,
    {
      id: 'response',
      sourceId,
      taskId: pageId,
      personId: 'member',
      taskRevision: 'v1',
      consentRevision: 1,
      policyRevision: 1,
      kind,
      payload: { text: 'The agenda is ready' },
    },
    now,
  );
  return db;
}
