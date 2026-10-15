import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import type { Actor, MutationResult, Page } from '@lasvegasfortransit/platform-core/staff-types';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, Statement } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditDenied } from './audits';
import { InvalidCursor } from './staff-history';

export interface WorkspaceOffboardingRow {
  identityRecordId: string;
  personId: string;
  workspaceSubject: string;
  reason: 'erased' | 'membership_ended';
  flaggedAt: string;
  revision: number;
}
async function allowed(db: Db, actor: Actor): Promise<boolean> {
  if (await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first())
    return true;
  await auditDenied(db, actor.personId, 'staff_admin.manage');
  return false;
}
export async function workspaceOffboardingQueue(
  db: Db,
  actor: Actor,
  options: { cursor?: string; limit?: number } = {},
): Promise<Page<WorkspaceOffboardingRow>> {
  if (!(await allowed(db, actor))) throw new PermissionDenied('staff_admin.manage');
  let cursor: [string, string] | null = null;
  if (options.cursor) {
    try {
      const value: unknown = JSON.parse(options.cursor);
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        value.some((part) => typeof part !== 'string' || part.length > 200)
      )
        throw new Error('Invalid');
      cursor = value as [string, string];
    } catch {
      throw new InvalidCursor();
    }
  }
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(100, Math.floor(options.limit ?? 25)))
    : 25;
  const { results } = await db
    .prepare(
      `SELECT q.identity_record_id AS identityRecordId,q.person_id AS personId,
    i.external_id AS workspaceSubject,q.reason,q.flagged_at AS flaggedAt,q.revision
    FROM workspace_offboarding_queue q JOIN identities i ON i.id=q.identity_record_id
    WHERE q.reviewed_at IS NULL AND ${STAFF_ADMIN_SCOPE}
      ${cursor ? 'AND (q.flagged_at,q.identity_record_id)>(?,?)' : ''}
    ORDER BY q.flagged_at,q.identity_record_id LIMIT ?`,
    )
    .bind(actor.personId, ...(cursor ?? []), limit + 1)
    .all<WorkspaceOffboardingRow>();
  const items = results.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      results.length > limit && last
        ? JSON.stringify([last.flaggedAt, last.identityRecordId])
        : null,
  };
}

interface ReviewInput {
  identityRecordId: string;
  expectedRevision: number;
  operationId: string;
}
function payloadFor(input: ReviewInput): string {
  return JSON.stringify({
    identityRecordId: input.identityRecordId,
    revision: input.expectedRevision,
  });
}
function reviewWrites(db: Db, actor: Actor, input: ReviewInput, now: Date): Statement[] {
  const values = [input.operationId, actor.personId, input.identityRecordId, payloadFor(input)];
  const fresh = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND payload=?
    AND kind='workspace.offboarding_reviewed' AND applied_at IS NULL) AND ${STAFF_ADMIN_SCOPE}`;
  const stamp = now.toISOString();
  return [
    db
      .prepare(
        `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at)
      SELECT ?,?,'workspace.offboarding_reviewed',?,?,? WHERE ${STAFF_ADMIN_SCOPE}
        AND EXISTS(SELECT 1 FROM workspace_offboarding_queue WHERE identity_record_id=? AND revision=? AND reviewed_at IS NULL)
      ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(...values, stamp, actor.personId, input.identityRecordId, input.expectedRevision),
    db
      .prepare(
        `UPDATE workspace_offboarding_queue SET reviewed_at=?,reviewed_by=?,reviewed_operation_id=?
      WHERE identity_record_id=? AND revision=? AND reviewed_at IS NULL AND ${fresh}`,
      )
      .bind(
        stamp,
        actor.personId,
        input.operationId,
        input.identityRecordId,
        input.expectedRevision,
        ...values,
        actor.personId,
      ),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT ?,?,'workspace.offboarding_reviewed',person_id,
        CASE WHEN EXISTS(SELECT 1 FROM person_keys WHERE id=q.person_id AND erased_at IS NOT NULL)
          THEN '{"personalDataErased":true}' ELSE '{}' END,?,?
      FROM workspace_offboarding_queue q WHERE identity_record_id=? AND reviewed_operation_id=? AND ${fresh}`,
      )
      .bind(
        ulid(),
        actor.personId,
        input.operationId,
        stamp,
        input.identityRecordId,
        input.operationId,
        ...values,
        actor.personId,
      ),
    db
      .prepare(
        `UPDATE staff_operations SET applied_at=?,result=? WHERE operation_id=? AND ${fresh}
      AND EXISTS(SELECT 1 FROM workspace_offboarding_queue WHERE identity_record_id=? AND reviewed_operation_id=?)`,
      )
      .bind(
        stamp,
        JSON.stringify({ identityRecordId: input.identityRecordId }),
        input.operationId,
        ...values,
        actor.personId,
        input.identityRecordId,
        input.operationId,
      ),
  ];
}

/** Records a human review. This action has no provider account or file operations. */
export async function reviewWorkspaceOffboarding(
  db: Db,
  actor: Actor,
  input: ReviewInput,
  now = new Date(),
): Promise<MutationResult<{ identityRecordId: string }>> {
  if (
    !input.identityRecordId ||
    input.identityRecordId.length > 200 ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    !/^[\w:-]{1,120}$/.test(input.operationId)
  )
    return { kind: 'invalid' };
  if (!(await allowed(db, actor))) return { kind: 'forbidden' };
  await db.batch(reviewWrites(db, actor, input, now));
  const values = [input.operationId, actor.personId, input.identityRecordId, payloadFor(input)];
  const result = await db
    .prepare(
      `SELECT result FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND payload=?
    AND kind='workspace.offboarding_reviewed' AND applied_at IS NOT NULL AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(...values, actor.personId)
    .first<{ result: string }>();
  return result
    ? { kind: 'ok', value: JSON.parse(result.result) as { identityRecordId: string } }
    : { kind: 'conflict' };
}
