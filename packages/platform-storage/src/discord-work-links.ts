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
export { setProjectEventForumTags, commitManagedForumTags } from './discord-work-link-tags';

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

/** Resolve by stable source and project IDs, never by a channel or project name. */
export async function findProjectHome(
  db: Db,
  scope: WorkScope,
  sourceId: string,
  projectId: string,
): Promise<ProjectHome | null> {
  const source = sourceId.replaceAll('-', '').toLowerCase(),
    project = projectId.replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(source) || !/^[0-9a-f]{32}$/.test(project)) return null;
  const rows = await db
    .prepare(
      "SELECT data_json FROM discord_project_homes WHERE scope_key=? AND state='active' AND coalesce(json_extract(data_json,'$.kind'),'project')='project' AND lower(replace(source_id,'-',''))=? AND lower(replace(project_id,'-',''))=? LIMIT 2",
    )
    .bind(workScopeKey(scope), source, project)
    .all<{ data_json: string }>();
  const row = rows.results[0];
  return rows.results.length === 1 && row ? (JSON.parse(row.data_json) as ProjectHome) : null;
}
/** Resolve existing active or paused project mappings by stable Notion identifiers. */
export async function findExistingProjectHomes(
  db: Db,
  scope: WorkScope,
  sourceId: string,
  projectId: string,
): Promise<ProjectHome[]> {
  const source = sourceId.replaceAll('-', '').toLowerCase(),
    project = projectId.replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(source) || !/^[0-9a-f]{32}$/.test(project)) return [];
  const rows = await db
    .prepare(
      "SELECT data_json FROM discord_project_homes WHERE scope_key=? AND state<>'unlinked' AND coalesce(json_extract(data_json,'$.kind'),'project')='project' AND lower(replace(source_id,'-',''))=? AND lower(replace(project_id,'-',''))=? LIMIT 2",
    )
    .bind(workScopeKey(scope), source, project)
    .all<{ data_json: string }>();
  return rows.results.map((row) => JSON.parse(row.data_json) as ProjectHome);
}
/** Locate matching project homes in the selected channel or its parent. */
export async function findProjectHomesForPlacement(
  db: Db,
  scope: WorkScope,
  input: { sourceId: string; projectIds: string[]; channelId: string; parentId: string | null },
): Promise<ProjectHome[]> {
  const { sourceId, projectIds, channelId, parentId } = input;
  const ids = projectIds.map((id) => id.replaceAll('-', '').toLowerCase());
  const source = sourceId.replaceAll('-', '').toLowerCase();
  if (!ids.length || ids.some((id) => !/^[0-9a-f]{32}$/.test(id)) || !/^[0-9a-f]{32}$/.test(source))
    return [];
  const rows = await db
    .prepare(
      "SELECT data_json FROM discord_project_homes WHERE scope_key=? AND state='active' AND coalesce(json_extract(data_json,'$.kind'),'project')='project' AND destination_id IN (?,?) AND lower(replace(source_id,'-',''))=? AND lower(replace(project_id,'-','')) IN (SELECT value FROM json_each(?)) LIMIT 2",
    )
    .bind(workScopeKey(scope), channelId, parentId, source, JSON.stringify(ids))
    .all<{ data_json: string }>();
  return rows.results.map((row) => JSON.parse(row.data_json) as ProjectHome);
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
  const source = subject.sourceId.replaceAll('-', '').toLowerCase();
  const page = subject.pageId.replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(source) || !/^[0-9a-f]{32}$/.test(page)) return null;
  const rows = await db
    .prepare(
      "SELECT data_json FROM discord_work_conversations WHERE scope_key=? AND state<>'unlinked' AND json_extract(data_json,'$.subject.kind')=? AND lower(replace(json_extract(data_json,'$.subject.sourceId'),'-',''))=? AND lower(replace(json_extract(data_json,'$.subject.pageId'),'-',''))=? LIMIT 2",
    )
    .bind(workScopeKey(scope), subject.kind, source, page)
    .all<{ data_json: string }>();
  const row = rows.results[0];
  return rows.results.length === 1 && row ? (JSON.parse(row.data_json) as WorkConversation) : null;
}
export async function listProjectHomes(db: Db, scope: WorkScope): Promise<ProjectHome[]> {
  const rows = await db
    .prepare(
      "SELECT data_json FROM discord_project_homes WHERE scope_key=? AND state<>'unlinked' AND coalesce(json_extract(data_json,'$.kind'),'project')='project' ORDER BY id LIMIT 50",
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

/** Read a bounded page scoped to the current Discord location. A 51st item signals overflow. */
export async function listProjectHomesAtDestination(
  db: Db,
  scope: WorkScope,
  destinationId: string,
  pageId?: string,
): Promise<ProjectHome[]> {
  const page = pageId?.replaceAll('-', '').toLowerCase() ?? null;
  const rows = await db
    .prepare(
      "SELECT data_json FROM discord_project_homes WHERE scope_key=? AND destination_id=? AND state<>'unlinked' AND (? IS NULL OR lower(replace(project_id,'-',''))=?) ORDER BY id LIMIT 51",
    )
    .bind(workScopeKey(scope), destinationId, page, page)
    .all<{ data_json: string }>();
  return rows.results.map((row) => JSON.parse(row.data_json) as ProjectHome);
}
export async function listWorkConversationsAtThread(
  db: Db,
  scope: WorkScope,
  threadId: string,
  pageId?: string,
): Promise<WorkConversation[]> {
  const page = pageId?.replaceAll('-', '').toLowerCase() ?? null;
  const rows = await db
    .prepare(
      "SELECT data_json FROM discord_work_conversations WHERE scope_key=? AND thread_id=? AND state<>'unlinked' AND (? IS NULL OR lower(replace(json_extract(data_json,'$.subject.pageId'),'-',''))=?) ORDER BY id LIMIT 51",
    )
    .bind(workScopeKey(scope), threadId, page, page)
    .all<{ data_json: string }>();
  return rows.results.map((row) => JSON.parse(row.data_json) as WorkConversation);
}
/** An existing project home must be reconciled or explicitly adopted before creating a forum. */
export async function hasOtherProjectHome(
  db: Db,
  scope: WorkScope,
  input: { sourceId: string; projectId: string; exceptId: string },
): Promise<boolean> {
  const { sourceId, projectId, exceptId } = input;
  const row = await db
    .prepare(
      "SELECT 1 FROM discord_project_homes WHERE scope_key=? AND state<>'unlinked' AND id<>? AND lower(replace(source_id,'-',''))=? AND lower(replace(project_id,'-',''))=? LIMIT 1",
    )
    .bind(
      workScopeKey(scope),
      exceptId,
      sourceId.replaceAll('-', '').toLowerCase(),
      projectId.replaceAll('-', '').toLowerCase(),
    )
    .first();
  return Boolean(row);
}
export async function dueWorkConversation(
  db: Db,
  input: { scope: WorkScope; stage: 'ingest' | 'refresh' },
  now: Date,
): Promise<WorkConversation | null> {
  const column = input.stage === 'ingest' ? 'next_attempt_at' : 'next_refresh_at';
  const mode =
    input.stage === 'ingest'
      ? " AND json_extract(data_json,'$.subject.kind')='task' AND json_extract(data_json,'$.mode')='automatic'"
      : '';
  const row = await db
    .prepare(
      `SELECT data_json FROM discord_work_conversations WHERE scope_key=? AND state='active'
    AND ${column}<=? ${mode} ORDER BY ${column},id LIMIT 1`,
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
    column = input.stage === 'ingest' ? 'next_attempt_at' : 'next_refresh_at',
    ownReason = input.stage === 'ingest' ? '$.ingestReason' : '$.refreshReason',
    otherReason = input.stage === 'ingest' ? '$.refreshReason' : '$.ingestReason';
  await db
    .prepare(
      `UPDATE discord_work_conversations SET ${column}=?,data_json=json_set(data_json,?,?,'$.reason',coalesce(?,json_extract(data_json,?))),updated_at=? WHERE id=? AND scope_key=? AND generation=?`,
    )
    .bind(
      new Date(now.getTime() + 60_000).toISOString(),
      ownReason,
      input.reason ?? null,
      input.reason ?? null,
      otherReason,
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
export async function saveWorkFooterBlockIds(
  db: Db,
  input: {
    scope: WorkScope;
    id: string;
    generation: number;
    ids: string[];
    heldOperationId?: string;
  },
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE discord_work_conversations SET data_json=json_set(data_json,'$.footerBlockIds',json(?)),updated_at=? WHERE scope_key=? AND id=? AND generation=? AND state='active' AND (? IS NULL OR EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.id=? AND o.scope_key=discord_work_conversations.scope_key AND o.conversation_id=discord_work_conversations.id AND o.generation=discord_work_conversations.generation AND o.state='held'))",
    )
    .bind(
      JSON.stringify(input.ids),
      now.toISOString(),
      workScopeKey(input.scope),
      input.id,
      input.generation,
      input.heldOperationId ?? null,
      input.heldOperationId ?? null,
    )
    .run();
  return result.meta.changes > 0;
}
export { unlinkWork } from './discord-work-unlink';
