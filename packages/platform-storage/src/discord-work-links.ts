import type { Db } from './db';
import {
  workScopeKey,
  workSubjectKey,
  type ProjectHome,
  type WorkConversation,
  type WorkScope,
  type WorkSubject,
} from './discord-work-types';
export type { ProjectHome, WorkConversation, WorkScope } from './discord-work-types';

export async function readProjectHome(
  db: Db,
  scope: WorkScope,
  id: string,
): Promise<ProjectHome | null> {
  const row = await db
    .prepare('SELECT data_json FROM discord_project_homes WHERE scope_key=? AND id=?')
    .bind(workScopeKey(scope), id)
    .first<{ data_json: string }>();
  return row ? (JSON.parse(row.data_json) as ProjectHome) : null;
}
export async function readWorkConversation(
  db: Db,
  scope: WorkScope,
  id: string,
): Promise<WorkConversation | null> {
  const row = await db
    .prepare('SELECT data_json FROM discord_work_conversations WHERE scope_key=? AND id=?')
    .bind(workScopeKey(scope), id)
    .first<{ data_json: string }>();
  return row ? (JSON.parse(row.data_json) as WorkConversation) : null;
}
export async function findWorkSubject(
  db: Db,
  scope: WorkScope,
  subject: WorkSubject,
): Promise<WorkConversation | null> {
  const row = await db
    .prepare(
      "SELECT data_json FROM discord_work_conversations WHERE scope_key=? AND subject_key=? AND state<>'unlinked' LIMIT 1",
    )
    .bind(workScopeKey(scope), workSubjectKey(subject))
    .first<{ data_json: string }>();
  return row ? (JSON.parse(row.data_json) as WorkConversation) : null;
}
export async function listProjectHomes(db: Db, scope: WorkScope): Promise<ProjectHome[]> {
  const rows = await db
    .prepare(
      "SELECT data_json FROM discord_project_homes WHERE scope_key=? AND state<>'unlinked' ORDER BY id LIMIT 50",
    )
    .bind(workScopeKey(scope))
    .all<{ data_json: string }>();
  return rows.results.map((r) => JSON.parse(r.data_json) as ProjectHome);
}
export async function listWorkConversations(
  db: Db,
  scope: WorkScope,
  homeId?: string,
): Promise<WorkConversation[]> {
  const rows = await db
    .prepare(
      "SELECT data_json FROM discord_work_conversations WHERE scope_key=? AND state<>'unlinked' AND (? IS NULL OR home_id=?) ORDER BY next_attempt_at,id LIMIT 50",
    )
    .bind(workScopeKey(scope), homeId ?? null, homeId ?? null)
    .all<{ data_json: string }>();
  return rows.results.map((r) => JSON.parse(r.data_json) as WorkConversation);
}
export async function dueWorkConversation(
  db: Db,
  input: { scope: WorkScope; stage: 'ingest' | 'refresh' },
  now: Date,
): Promise<WorkConversation | null> {
  const column = input.stage === 'ingest' ? 'next_attempt_at' : 'next_refresh_at';
  const mode = input.stage === 'ingest' ? " AND json_extract(data_json,'$.mode')='automatic'" : '';
  const row = await db
    .prepare(
      `SELECT data_json FROM discord_work_conversations WHERE scope_key=? AND state='active'
    AND json_extract(data_json,'$.subject.kind')='task' AND ${column}<=? ${mode} ORDER BY ${column},id LIMIT 1`,
    )
    .bind(workScopeKey(input.scope), now.toISOString())
    .first<{ data_json: string }>();
  return row ? (JSON.parse(row.data_json) as WorkConversation) : null;
}
export async function deferWorkConversation(
  db: Db,
  input: {
    conversation: WorkConversation;
    stage: 'ingest' | 'refresh';
    reason?: string | undefined;
  },
  now: Date,
): Promise<void> {
  const c = input.conversation,
    column = input.stage === 'ingest' ? 'next_attempt_at' : 'next_refresh_at';
  await db
    .prepare(
      `UPDATE discord_work_conversations SET ${column}=?,data_json=json_set(data_json,'$.reason',?),updated_at=? WHERE id=? AND scope_key=? AND generation=?`,
    )
    .bind(
      new Date(now.getTime() + 60_000).toISOString(),
      input.reason ?? null,
      now.toISOString(),
      c.id,
      workScopeKey(c.scope),
      c.generation,
    )
    .run();
}
export async function saveProjectHome(
  db: Db,
  input: ProjectHome,
  expected: number,
  now: Date,
): Promise<boolean> {
  if (input.generation !== expected + 1) return false;
  const key = workScopeKey(input.scope),
    json = JSON.stringify(input),
    stamp = now.toISOString();
  const result =
    expected === 0
      ? await db
          .prepare(
            'INSERT OR IGNORE INTO discord_project_homes(id,scope_key,source_id,project_id,destination_id,state,generation,data_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            input.id,
            key,
            input.projectSourceId,
            input.projectId,
            input.destination.channelId,
            input.state,
            input.generation,
            json,
            stamp,
          )
          .run()
      : await db
          .prepare(
            'UPDATE OR IGNORE discord_project_homes SET destination_id=?,state=?,generation=?,data_json=?,updated_at=? WHERE id=? AND scope_key=? AND generation=?',
          )
          .bind(
            input.destination.channelId,
            input.state,
            input.generation,
            json,
            stamp,
            input.id,
            key,
            expected,
          )
          .run();
  return result.meta.changes > 0;
}
export async function saveWorkConversation(
  db: Db,
  input: WorkConversation,
  expected: number,
  now: Date,
): Promise<boolean> {
  if (input.generation !== expected + 1) return false;
  const key = workScopeKey(input.scope),
    json = JSON.stringify(input),
    stamp = now.toISOString();
  const result =
    expected === 0
      ? await db
          .prepare(
            `INSERT OR IGNORE INTO discord_work_conversations(id,scope_key,home_id,subject_key,thread_id,state,generation,data_json,next_attempt_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM discord_project_homes WHERE id=? AND scope_key=? AND state<>'unlinked')`,
          )
          .bind(
            input.id,
            key,
            input.homeId,
            workSubjectKey(input.subject),
            input.threadId,
            input.state,
            input.generation,
            json,
            stamp,
            stamp,
            input.homeId,
            key,
          )
          .run()
      : await db
          .prepare(
            'UPDATE OR IGNORE discord_work_conversations SET state=?,generation=?,data_json=?,next_attempt_at=?,updated_at=? WHERE id=? AND scope_key=? AND generation=?',
          )
          .bind(input.state, input.generation, json, stamp, stamp, input.id, key, expected)
          .run();
  return result.meta.changes > 0;
}
/** Cursor/card updates retain generation; only semantic link edits advance it. */
export async function updateWorkConversation(
  db: Db,
  input: WorkConversation,
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE discord_work_conversations SET data_json=?,next_attempt_at=?,updated_at=? WHERE id=? AND scope_key=? AND generation=? AND state=?',
    )
    .bind(
      JSON.stringify(input),
      new Date(now.getTime() + 60_000).toISOString(),
      now.toISOString(),
      input.id,
      workScopeKey(input.scope),
      input.generation,
      input.state,
    )
    .run();
  return result.meta.changes > 0;
}
export async function unlinkWork(
  db: Db,
  input: { scope: WorkScope; id: string; generation: number },
  now: Date,
): Promise<boolean> {
  const { scope, id, generation } = input;
  const key = workScopeKey(scope),
    stamp = now.toISOString();
  const result = await db
    .prepare(
      `UPDATE discord_work_conversations SET state='unlinked',generation=generation+1,
    data_json=json_set(data_json,'$.state','unlinked','$.generation',generation+1),updated_at=?
    WHERE id=? AND scope_key=? AND generation=? AND state<>'unlinked'`,
    )
    .bind(stamp, id, key, generation)
    .run();
  if (result.meta.changes) {
    await db
      .prepare(
        "UPDATE discord_work_operations SET state='superseded',reason='unlinked',updated_at=? WHERE scope_key=? AND conversation_id=? AND state IN ('preview','queued','retryable')",
      )
      .bind(stamp, key, id)
      .run();
    return true;
  }
  const home = await db
    .prepare(
      `UPDATE discord_project_homes SET state='unlinked',generation=generation+1,
    data_json=json_set(data_json,'$.state','unlinked','$.generation',generation+1),updated_at=? WHERE id=? AND scope_key=? AND generation=? AND state<>'unlinked'`,
    )
    .bind(stamp, id, key, generation)
    .run();
  if (home.meta.changes) {
    await db
      .prepare(
        `UPDATE discord_work_conversations SET state='unlinked',generation=generation+1,data_json=json_set(data_json,'$.state','unlinked','$.generation',generation+1),updated_at=? WHERE home_id=? AND scope_key=? AND state<>'unlinked'`,
      )
      .bind(stamp, id, key)
      .run();
    await db
      .prepare(
        "UPDATE discord_work_operations SET state='superseded',reason='unlinked',updated_at=? WHERE scope_key=? AND home_id=? AND state IN ('preview','queued','retryable')",
      )
      .bind(stamp, key, id)
      .run();
  }
  return home.meta.changes > 0;
}
