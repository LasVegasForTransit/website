import type { Db } from './db';
import { workScopeKey, type WorkScope } from './discord-work-types';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditedTaskCheckinChange } from './notion-task-admin-audit';

export interface WorkRoute {
  id: string;
  scope: WorkScope;
  sourceId: string;
  sourceTitle?: string;
  kind: 'project' | 'event';
  state: 'active' | 'paused';
  revision: number;
  baselineRevision?: number;
  trigger: { property: string; values: string[] };
  projectRelation?: { property: string; projectSourceId: string };
  destination: { kind: 'category' | 'forum' | 'text'; channelId: string };
  tagIds?: string[];
  tagSync?: { property: string; mappings: { value: string; tagName: string }[] };
  approvedBy: string;
  approvedDiscordId?: string;
  approvedGrantVersion?: string;
  audienceFingerprint: string;
}

export async function listWorkRoutes(
  db: Db,
  scope: WorkScope,
  after = '',
): Promise<{ items: WorkRoute[]; nextCursor: string | null }> {
  const rows = await db
    .prepare(
      'SELECT data_json FROM discord_work_routes WHERE scope_key=? AND id>? ORDER BY id LIMIT 11',
    )
    .bind(workScopeKey(scope), after)
    .all<{ data_json: string }>();
  const routes = rows.results.map((row) => JSON.parse(row.data_json) as WorkRoute);
  const items = routes.slice(0, 10);
  return { items, nextCursor: routes.length > 10 ? (items.at(-1)?.id ?? null) : null };
}

function normalizedSource(value: string): string | null {
  const id = value.replaceAll('-', '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(id) ? id : null;
}

function validTagMapping(value: unknown): value is { value: string; tagName: string } {
  if (!value || typeof value !== 'object') return false;
  const mapping = value as { value?: unknown; tagName?: unknown };
  return (
    typeof mapping.value === 'string' &&
    Boolean(mapping.value.trim()) &&
    mapping.value.length <= 100 &&
    typeof mapping.tagName === 'string' &&
    Boolean(mapping.tagName.trim()) &&
    mapping.tagName.length <= 20
  );
}

function validTagSync(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const sync = value as { property?: unknown; mappings?: unknown };
  if (
    typeof sync.property !== 'string' ||
    !sync.property.trim() ||
    sync.property.length > 128 ||
    !Array.isArray(sync.mappings) ||
    sync.mappings.length < 1 ||
    sync.mappings.length > 25
  )
    return false;
  const seen = new Set<string>();
  for (const mapping of sync.mappings as unknown[]) {
    if (!validTagMapping(mapping) || seen.has(mapping.value)) return false;
    seen.add(mapping.value);
  }
  return true;
}

function validRouteDestination(route: WorkRoute): boolean {
  return !(
    !validTagSync(route.tagSync) ||
    (route.tagSync !== undefined && route.destination.kind === 'text') ||
    (route.tagIds !== undefined &&
      (route.tagIds.length > 5 ||
        new Set(route.tagIds).size !== route.tagIds.length ||
        route.tagIds.some((id) => !id))) ||
    (route.destination.kind !== 'forum' && (route.tagIds?.length ?? 0) > 0)
  );
}

function validRouteRelation(route: WorkRoute): boolean {
  if (route.projectRelation !== undefined) {
    return (
      route.kind === 'event' &&
      route.destination.kind === 'category' &&
      Boolean(route.projectRelation.property.trim()) &&
      Boolean(normalizedSource(route.projectRelation.projectSourceId))
    );
  }
  return route.kind !== 'event' || route.destination.kind !== 'category';
}

/** Callers must separately verify the source, destination, and approved audience. */
export async function saveWorkRoute(
  db: Db,
  actor: { personId: string },
  input: { route: WorkRoute; expected: number },
  now: Date,
): Promise<boolean> {
  const { route, expected } = input;
  const source = normalizedSource(route.sourceId);
  if (
    !source ||
    !route.id ||
    route.state !== 'paused' ||
    route.revision !== expected + 1 ||
    route.approvedBy !== actor.personId ||
    !route.audienceFingerprint ||
    !route.destination.channelId ||
    !route.trigger.property.trim() ||
    !route.trigger.values.length ||
    route.trigger.values.some((value) => !value.trim()) ||
    !validRouteDestination(route) ||
    !validRouteRelation(route)
  )
    return false;
  const key = workScopeKey(route.scope);
  const json = JSON.stringify({ ...route, sourceId: source });
  const stamp = now.toISOString();
  const mutation =
    expected === 0
      ? db
          .prepare(
            `INSERT OR IGNORE INTO discord_work_routes(id,scope_key,source_id,state,revision,data_json,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${STAFF_ADMIN_SCOPE}`,
          )
          .bind(route.id, key, source, route.state, route.revision, json, stamp, actor.personId)
      : db
          .prepare(
            `UPDATE OR IGNORE discord_work_routes SET source_id=?,state=?,revision=?,data_json=?,updated_at=? WHERE id=? AND scope_key=? AND revision=? AND ${STAFF_ADMIN_SCOPE}`,
          )
          .bind(
            source,
            route.state,
            route.revision,
            json,
            stamp,
            route.id,
            key,
            expected,
            actor.personId,
          );
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: 'discord_work.configure_route',
    targetId: route.id,
    now,
  });
}

/** Call only after freshly verifying the actor, source, destination, and audience with the providers. */
export async function activateWorkRoute(
  db: Db,
  actor: { personId: string },
  input: {
    scope: WorkScope;
    id: string;
    expected: number;
    approval: { discordUserId: string; grantVersion: string; audienceFingerprint: string };
  },
  now: Date,
): Promise<boolean> {
  const { scope, id, expected, approval } = input;
  if (
    !/^[0-9]{17,20}$/.test(approval.discordUserId) ||
    !approval.grantVersion ||
    !approval.audienceFingerprint ||
    !Number.isSafeInteger(expected) ||
    expected < 1
  )
    return false;
  const key = workScopeKey(scope),
    stamp = now.toISOString();
  const mutation = db
    .prepare(
      `UPDATE OR IGNORE discord_work_routes SET state='active',revision=revision+1,updated_at=?,
    data_json=json_set(data_json,'$.state','active','$.revision',revision+1,'$.baselineRevision',revision,'$.approvedBy',?,'$.approvedDiscordId',?,'$.approvedGrantVersion',?)
    WHERE id=? AND scope_key=? AND state='paused' AND revision=? AND json_extract(data_json,'$.audienceFingerprint')=? AND ${STAFF_ADMIN_SCOPE}
    AND EXISTS(SELECT 1 FROM identities i JOIN people p ON p.id=i.person_id WHERE i.person_id=? AND i.platform='discord' AND i.external_id=? AND i.link_method IN ('self_linked','staff_confirmed') AND p.deleted_at IS NULL AND p.erased_at IS NULL AND (SELECT count(*) FROM identities j WHERE j.person_id=p.id AND j.platform='discord')=1 AND NOT EXISTS(SELECT 1 FROM discord_disconnects d WHERE d.identity_record_id=i.id))
    AND EXISTS(SELECT 1 FROM discord_work_route_scans s WHERE s.route_id=discord_work_routes.id AND s.scope_key=discord_work_routes.scope_key AND s.revision=discord_work_routes.revision AND s.mode='baseline' AND s.cursor IS NULL AND s.claim_token IS NULL AND s.baseline_completed_at IS NOT NULL)`,
    )
    .bind(
      stamp,
      actor.personId,
      approval.discordUserId,
      approval.grantVersion,
      id,
      key,
      expected,
      approval.audienceFingerprint,
      actor.personId,
      actor.personId,
      approval.discordUserId,
    );
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: 'discord_work.activate_route',
    targetId: id,
    now,
    after: (auditId) => [
      db
        .prepare(
          "UPDATE discord_work_route_scans SET revision=?,mode='scan',baseline_completed_at=NULL,cursor=NULL,next_attempt_at=?,updated_at=? WHERE route_id=? AND scope_key=? AND revision=? AND EXISTS(SELECT 1 FROM staff_audits WHERE id=?)",
        )
        .bind(expected + 1, stamp, stamp, id, key, expected, auditId),
    ],
  });
}

export async function readWorkRoute(
  db: Db,
  scope: WorkScope,
  id: string,
): Promise<WorkRoute | null> {
  const row = await db
    .prepare('SELECT data_json FROM discord_work_routes WHERE id=? AND scope_key=?')
    .bind(id, workScopeKey(scope))
    .first<{ data_json: string }>();
  return row ? (JSON.parse(row.data_json) as WorkRoute) : null;
}

/** Resolve by the immutable Notion data-source identity, not by a page title or channel name. */
export async function findActiveWorkRoute(
  db: Db,
  scope: WorkScope,
  sourceId: string,
): Promise<WorkRoute | null> {
  const source = normalizedSource(sourceId);
  if (!source) return null;
  const row = await db
    .prepare(
      "SELECT data_json FROM discord_work_routes WHERE scope_key=? AND source_id=? AND state='active'",
    )
    .bind(workScopeKey(scope), source)
    .first<{ data_json: string }>();
  return row ? (JSON.parse(row.data_json) as WorkRoute) : null;
}
