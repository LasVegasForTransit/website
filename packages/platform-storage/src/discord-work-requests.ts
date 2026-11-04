import type { Db } from './db';
import { workScopeKey, type WorkScope } from './discord-work-types';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditedTaskCheckinChange } from './notion-task-admin-audit';
import type { PendingWorkRequest } from './discord-work-reviewed';
export { readReviewedWorkRequest } from './discord-work-reviewed';

/** Recheck held requests only when no provision operation has ever been attached or queued. */
export async function retryHeldWorkRequests(
  db: Db,
  actor: { personId: string },
  input: { scope: WorkScope; routeId: string; revision: number },
  now: Date,
): Promise<boolean> {
  const { scope, routeId, revision } = input;
  const key = workScopeKey(scope);
  const mutation = db
    .prepare(
      `UPDATE discord_work_requests SET state='pending',reason=NULL,next_attempt_at=NULL
    WHERE id IN (SELECT q.id FROM discord_work_requests q JOIN discord_work_routes r ON r.id=q.route_id AND r.scope_key=q.scope_key
      WHERE q.scope_key=? AND q.route_id=? AND q.route_revision=? AND r.state='active' AND r.revision=q.route_revision
      AND q.state='held' AND q.operation_id IS NULL AND NOT EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.scope_key=q.scope_key AND o.source_key='route-request:' || q.id)
      ORDER BY q.created_at,q.id LIMIT 5) AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(key, routeId, revision, actor.personId);
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: 'discord_work.retry_route_requests',
    targetId: routeId,
    now,
  });
}

/** Retry a tag failure known to precede any provider effect; uncertain operations stay held. */
export async function retryPreflightTagFailures(
  db: Db,
  actor: { personId: string },
  input: { scope: WorkScope; routeId: string; revision: number },
  now: Date,
): Promise<boolean> {
  const { scope, routeId, revision } = input;
  const stamp = now.toISOString();
  const mutation = db
    .prepare(
      `UPDATE discord_work_operations SET state='queued',reason=NULL,next_attempt_at=?,updated_at=?
    WHERE id IN (SELECT o.id FROM discord_work_requests q JOIN discord_work_operations o ON o.id=q.operation_id AND o.scope_key=q.scope_key
      JOIN discord_work_routes r ON r.id=q.route_id AND r.scope_key=q.scope_key
      WHERE q.scope_key=? AND q.route_id=? AND q.route_revision=? AND q.state IN ('held','processing')
      AND r.state='active' AND r.revision=q.route_revision AND o.kind='provision' AND o.state='failed'
      AND o.reason='forum_tag_required' AND o.result_json IS NULL AND o.home_id IS NULL
      AND json_extract(o.payload_json,'$.intent')='event' AND json_extract(o.payload_json,'$.projectId') IS NOT NULL
      ORDER BY q.created_at,q.id LIMIT 5) AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(stamp, stamp, workScopeKey(scope), routeId, revision, actor.personId);
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: 'discord_work.retry_route_tag_preflight',
    targetId: routeId,
    now,
  });
}

/** Ask recovery to verify an existing effect; never queue another creation directly. */
export async function retryEligibilityRecovery(
  db: Db,
  actor: { personId: string },
  input: { scope: WorkScope; routeId: string; revision: number },
  now: Date,
): Promise<boolean> {
  const { scope, routeId, revision } = input;
  const stamp = now.toISOString();
  const mutation = db
    .prepare(
      `UPDATE discord_work_operations SET reason='unconfirmed_effect',next_attempt_at=?,updated_at=?
    WHERE id IN (SELECT o.id FROM discord_work_requests q JOIN discord_work_operations o ON o.id=q.operation_id AND o.scope_key=q.scope_key
      JOIN discord_work_routes r ON r.id=q.route_id AND r.scope_key=q.scope_key
      WHERE q.scope_key=? AND q.route_id=? AND q.route_revision=? AND q.state IN ('held','processing')
      AND r.state='active' AND r.revision=q.route_revision AND o.kind='provision' AND o.state='held'
      AND o.reason='eligibility_changed_after_effect' AND (o.home_id IS NOT NULL OR o.result_json IS NOT NULL)
      AND o.source_key='route-request:' || q.id AND json_extract(o.payload_json,'$.routeId')=r.id
      AND json_extract(o.payload_json,'$.routeRevision')=r.revision
      ORDER BY q.created_at,q.id LIMIT 5) AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(stamp, stamp, workScopeKey(scope), routeId, revision, actor.personId);
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: 'discord_work.retry_eligibility_recovery',
    targetId: routeId,
    now,
  });
}

/** Retry only failures known to have stopped before a Discord write. */
export async function retryFailedWorkTagChecks(
  db: Db,
  actor: { personId: string },
  input: { scope: WorkScope; routeId: string; revision: number },
  now: Date,
): Promise<boolean> {
  const { scope, routeId, revision } = input;
  const stamp = now.toISOString();
  const mutation = db
    .prepare(
      `UPDATE OR IGNORE discord_work_operations SET state='queued',reason=NULL,result_json=NULL,attempts=0,next_attempt_at=?,updated_at=?
    WHERE id IN (SELECT o.id FROM discord_work_operations o JOIN discord_work_routes r ON r.id=json_extract(o.payload_json,'$.routeId') AND r.scope_key=o.scope_key
      JOIN discord_work_conversations c ON c.id=o.conversation_id AND c.scope_key=o.scope_key
      WHERE o.scope_key=? AND r.id=? AND r.state='active' AND r.revision=? AND json_extract(o.payload_json,'$.routeRevision')=r.revision
      AND o.kind='refresh' AND json_extract(o.payload_json,'$.intent')='tag-sync' AND o.state='failed' AND ((o.reason='tag_mapping_unavailable' AND o.result_json IS NULL) OR (o.reason='forum_tags_changed' AND o.result_json IS NOT NULL))
      AND NOT EXISTS(SELECT 1 FROM discord_work_operations later WHERE later.scope_key=o.scope_key AND later.conversation_id=o.conversation_id AND later.kind='refresh' AND later.state='confirmed' AND json_extract(later.payload_json,'$.intent')='tag-sync' AND json_extract(later.payload_json,'$.routeId')=r.id AND json_extract(later.payload_json,'$.routeRevision')=r.revision AND later.rowid>o.rowid)
      AND c.state='active' AND c.generation=o.generation ORDER BY o.created_at,o.id LIMIT 5) AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(stamp, stamp, workScopeKey(scope), routeId, revision, actor.personId);
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: 'discord_work.retry_tag_sync_checks',
    targetId: routeId,
    now,
  });
}

interface WorkObservationInput {
  scope: WorkScope;
  routeId: string;
  revision: number;
  pageId: string;
  eligible: boolean;
  createdAt: Date;
  editedAt: Date;
  scanToken?: string;
}
interface ObservationContext {
  page: string;
  scope: string;
  created: string;
  edited: string;
  stamp: string;
}

/** Persist a routing signal only after fetching current provider state. This does not perform provider writes. */
export async function recordWorkObservation(
  db: Db,
  input: WorkObservationInput,
  now: Date,
): Promise<boolean> {
  const page = input.pageId.replaceAll('-', '').toLowerCase();
  if (
    !/^[0-9a-f]{32}$/.test(page) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !Number.isFinite(input.createdAt.getTime()) ||
    !Number.isFinite(input.editedAt.getTime()) ||
    input.editedAt < input.createdAt
  )
    return false;
  const scope = workScopeKey(input.scope),
    created = input.createdAt.toISOString(),
    edited = input.editedAt.toISOString(),
    stamp = now.toISOString();
  const context = { page, scope, created, edited, stamp };
  const insert = observationInsert(db, input, context);
  const resume = observationResume(db, input, context);
  const resumeRequest = observationResumeRequest(db, input, context);
  const observe = observationUpdate(db, input, context);
  const result = await db.batch([insert, resume, resumeRequest, observe]);
  const first = result[0] as { meta?: { changes?: number } } | undefined;
  const resumed = result[1] as { meta?: { changes?: number } } | undefined;
  return (first?.meta?.changes ?? 0) > 0 || (resumed?.meta?.changes ?? 0) > 0;
}

function observationInsert(db: Db, input: WorkObservationInput, context: ObservationContext) {
  const { page, scope, created, edited, stamp } = context;
  return db
    .prepare(
      `INSERT INTO discord_work_requests(id,scope_key,source_id,page_id,route_id,route_revision,state,created_at,existing_event)
    SELECT CASE WHEN json_extract(r.data_json,'$.kind')='event' AND EXISTS(SELECT 1 FROM discord_work_observations b WHERE b.route_id=r.id AND b.page_id=? AND b.revision=json_extract(r.data_json,'$.baselineRevision') AND b.eligible=1) THEN 'existing-' || ? ELSE ? END,r.scope_key,r.source_id,?,r.id,r.revision,'pending',?,CASE WHEN json_extract(r.data_json,'$.kind')='event' AND EXISTS(SELECT 1 FROM discord_work_observations b WHERE b.route_id=r.id AND b.page_id=? AND b.revision=json_extract(r.data_json,'$.baselineRevision') AND b.eligible=1) THEN 1 ELSE 0 END FROM discord_work_routes r
    WHERE r.id=? AND r.scope_key=? AND r.state='active' AND r.revision=? AND ?=1 AND (
      EXISTS(SELECT 1 FROM discord_work_observations o WHERE o.route_id=r.id AND o.page_id=? AND o.revision IN (r.revision,coalesce(json_extract(r.data_json,'$.baselineRevision'),r.revision)) AND o.eligible=0 AND o.edited_at<?)
      OR (NOT EXISTS(SELECT 1 FROM discord_work_observations o WHERE o.route_id=r.id AND o.page_id=? AND o.revision IN (r.revision,coalesce(json_extract(r.data_json,'$.baselineRevision'),r.revision))) AND ?>r.updated_at)
      OR (json_extract(r.data_json,'$.kind')='event' AND EXISTS(SELECT 1 FROM discord_work_observations b WHERE b.route_id=r.id AND b.page_id=? AND b.revision=json_extract(r.data_json,'$.baselineRevision') AND b.eligible=1)))
    AND (? IS NULL OR EXISTS(SELECT 1 FROM discord_work_route_scans s WHERE s.route_id=r.id AND s.scope_key=r.scope_key AND s.revision=r.revision AND s.claim_token=? AND s.lease_expires_at>?))
    ON CONFLICT(scope_key,source_id,page_id) DO UPDATE SET route_id=excluded.route_id,route_revision=excluded.route_revision,state='pending',reason=excluded.reason,next_attempt_at=NULL,created_at=excluded.created_at,existing_event=excluded.existing_event
    WHERE discord_work_requests.operation_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM discord_work_operations existing WHERE existing.scope_key=discord_work_requests.scope_key AND existing.source_key='route-request:' || discord_work_requests.id)
    AND (discord_work_requests.state IN ('held','superseded') OR (discord_work_requests.state='pending' AND (discord_work_requests.route_id<>excluded.route_id OR discord_work_requests.route_revision<>excluded.route_revision)))`,
    )
    .bind(
      page,
      crypto.randomUUID(),
      crypto.randomUUID(),
      page,
      stamp,
      page,
      input.routeId,
      scope,
      input.revision,
      Number(input.eligible),
      page,
      edited,
      page,
      created,
      page,
      input.scanToken ?? null,
      input.scanToken ?? null,
      stamp,
    );
}

function observationResume(db: Db, input: WorkObservationInput, context: ObservationContext) {
  const { page, scope, edited, stamp } = context;
  // A provision superseded at the eligibility preflight has made no provider write only
  // when it has neither a home nor a checkpoint. Reuse that same operation, never a new key.
  return db
    .prepare(
      `UPDATE OR IGNORE discord_work_operations SET state='queued',reason='reeligible',payload_json=json_remove(payload_json,'$.ineligibleEditedAt'),attempts=0,next_attempt_at=?,updated_at=?
      WHERE scope_key=? AND kind='provision' AND state='superseded' AND reason='not_eligible' AND home_id IS NULL AND result_json IS NULL
      AND EXISTS(SELECT 1 FROM discord_work_requests q JOIN discord_work_routes r ON r.id=q.route_id AND r.scope_key=q.scope_key
        JOIN discord_work_observations o ON o.route_id=r.id AND o.page_id=q.page_id
        WHERE q.operation_id=discord_work_operations.id AND q.scope_key=discord_work_operations.scope_key
        AND discord_work_operations.source_key='route-request:' || q.id AND q.state IN ('processing','superseded')
        AND q.page_id=? AND q.route_id=? AND q.route_revision=? AND r.state='active' AND r.revision=q.route_revision
        AND o.revision IN (r.revision,coalesce(json_extract(r.data_json,'$.baselineRevision'),r.revision))
        AND ((o.eligible=0 AND o.edited_at<?) OR (o.eligible=1 AND o.edited_at<=? AND ?>json_extract(discord_work_operations.payload_json,'$.ineligibleEditedAt'))) AND ?=1
        AND (? IS NULL OR EXISTS(SELECT 1 FROM discord_work_route_scans s WHERE s.route_id=r.id AND s.scope_key=r.scope_key AND s.revision=r.revision AND s.claim_token=? AND s.lease_expires_at>?)))`,
    )
    .bind(
      stamp,
      stamp,
      scope,
      page,
      input.routeId,
      input.revision,
      edited,
      edited,
      edited,
      Number(input.eligible),
      input.scanToken ?? null,
      input.scanToken ?? null,
      stamp,
    );
}

function observationResumeRequest(
  db: Db,
  input: WorkObservationInput,
  context: ObservationContext,
) {
  const { page, scope } = context;
  return db
    .prepare(
      `UPDATE discord_work_requests SET state='processing',reason=NULL,next_attempt_at=NULL
      WHERE scope_key=? AND route_id=? AND route_revision=? AND page_id=? AND state IN ('processing','superseded')
      AND EXISTS(SELECT 1 FROM discord_work_operations op WHERE op.id=discord_work_requests.operation_id AND op.scope_key=discord_work_requests.scope_key AND op.state='queued' AND op.reason='reeligible')`,
    )
    .bind(scope, input.routeId, input.revision, page);
}

function observationUpdate(db: Db, input: WorkObservationInput, context: ObservationContext) {
  const { page, scope, edited, stamp } = context;
  return db
    .prepare(
      `INSERT INTO discord_work_observations(route_id,page_id,revision,eligible,edited_at,observed_at)
    SELECT r.id,?,r.revision,?,?,? FROM discord_work_routes r WHERE r.id=? AND r.scope_key=? AND r.revision=? AND (r.state='active' OR (r.state='paused' AND ? IS NOT NULL AND EXISTS(SELECT 1 FROM discord_work_route_scans baseline WHERE baseline.route_id=r.id AND baseline.scope_key=r.scope_key AND baseline.revision=r.revision AND baseline.mode='baseline')))
    AND (? IS NULL OR EXISTS(SELECT 1 FROM discord_work_route_scans s WHERE s.route_id=r.id AND s.scope_key=r.scope_key AND s.revision=r.revision AND s.claim_token=? AND s.lease_expires_at>?))
    ON CONFLICT(route_id,page_id) DO UPDATE SET revision=excluded.revision,eligible=excluded.eligible,edited_at=excluded.edited_at,observed_at=excluded.observed_at
    WHERE excluded.revision>discord_work_observations.revision OR (excluded.revision=discord_work_observations.revision AND excluded.edited_at>discord_work_observations.edited_at)`,
    )
    .bind(
      page,
      Number(input.eligible),
      edited,
      stamp,
      input.routeId,
      scope,
      input.revision,
      input.scanToken ?? null,
      input.scanToken ?? null,
      input.scanToken ?? null,
      stamp,
    );
}

export async function nextWorkRouteRequest(
  db: Db,
  scope: WorkScope,
  now: Date,
): Promise<PendingWorkRequest | null> {
  return db
    .prepare(
      `SELECT q.id,q.page_id,q.source_id,q.route_id,q.route_revision,q.existing_event FROM discord_work_requests q JOIN discord_work_routes r ON r.id=q.route_id AND r.scope_key=q.scope_key
    WHERE q.scope_key=? AND q.state='pending' AND (q.next_attempt_at IS NULL OR q.next_attempt_at<=?) AND r.state='active' AND r.revision=q.route_revision AND json_extract(r.data_json,'$.kind') IN ('project','event') ORDER BY q.created_at,q.id LIMIT 1`,
    )
    .bind(workScopeKey(scope), now.toISOString())
    .first<PendingWorkRequest>();
}

/** Atomically connect a stable request to one provision operation while its approved route is current. */
export async function queueWorkRouteRequest(
  db: Db,
  input: {
    scope: WorkScope;
    request: PendingWorkRequest;
    reviewed?: boolean;
    effect: {
      actor: { personId: string; discordUserId: string; grantVersion: string };
      payload: Record<string, unknown>;
    };
  },
  now: Date,
): Promise<boolean> {
  const {
    scope,
    request,
    effect: { actor, payload },
  } = input;
  const key = workScopeKey(scope),
    opId = `route-${request.id}`,
    sourceKey = `route-request:${request.id}`,
    stamp = now.toISOString();
  const create = db
    .prepare(
      `INSERT OR IGNORE INTO discord_work_operations(id,scope_key,home_id,conversation_id,generation,kind,source_key,actor_person_id,actor_discord_id,grant_version,original_author_id,payload_json,state,next_attempt_at,created_at,updated_at)
    SELECT ?,q.scope_key,NULL,NULL,1,'provision',?,?,?,?,?,?,'queued',?,?,? FROM discord_work_requests q JOIN discord_work_routes r ON r.id=q.route_id AND r.scope_key=q.scope_key
    WHERE q.id=? AND q.scope_key=? AND q.existing_event=? AND ((?=0 AND q.state='pending') OR (?=1 AND q.state='held' AND q.reason='existing_event_review' AND q.existing_event=1 AND q.operation_id IS NULL)) AND r.state='active' AND r.revision=q.route_revision AND q.route_revision=?
    AND json_extract(r.data_json,'$.approvedBy')=? AND json_extract(r.data_json,'$.approvedDiscordId')=? AND json_extract(r.data_json,'$.approvedGrantVersion')=?`,
    )
    .bind(
      opId,
      sourceKey,
      actor.personId,
      actor.discordUserId,
      actor.grantVersion,
      actor.discordUserId,
      JSON.stringify(payload),
      stamp,
      stamp,
      stamp,
      request.id,
      key,
      request.existing_event,
      Number(input.reviewed === true),
      Number(input.reviewed === true),
      request.route_revision,
      actor.personId,
      actor.discordUserId,
      actor.grantVersion,
    );
  const update = db
    .prepare(
      `UPDATE discord_work_requests SET state='processing',operation_id=?,reason=NULL WHERE id=? AND scope_key=? AND existing_event=? AND ((?=0 AND state='pending') OR (?=1 AND state='held' AND reason='existing_event_review' AND existing_event=1 AND operation_id IS NULL))
    AND EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.id=? AND o.scope_key=? AND o.source_key=?)
    AND EXISTS(SELECT 1 FROM discord_work_routes r WHERE r.id=discord_work_requests.route_id AND r.scope_key=discord_work_requests.scope_key AND r.state='active' AND r.revision=discord_work_requests.route_revision)`,
    )
    .bind(
      opId,
      request.id,
      key,
      request.existing_event,
      Number(input.reviewed === true),
      Number(input.reviewed === true),
      opId,
      key,
      sourceKey,
    );
  const result = await db.batch([create, update]);
  return ((result[1] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) > 0;
}

export async function holdWorkRouteRequest(
  db: Db,
  scope: WorkScope,
  request: PendingWorkRequest,
  reason: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE discord_work_requests SET state='held',reason=? WHERE id=? AND scope_key=? AND state='pending' AND route_revision=? AND existing_event=?",
    )
    .bind(reason, request.id, workScopeKey(scope), request.route_revision, request.existing_event)
    .run();
}

export async function deferWorkRouteRequest(
  db: Db,
  input: {
    scope: WorkScope;
    request: PendingWorkRequest;
    retry: { reason: string; retryAfterMs: number };
  },
  now: Date,
): Promise<void> {
  const {
    scope,
    request,
    retry: { reason, retryAfterMs },
  } = input;
  const delay = Math.max(1_000, Math.min(86_400_000, retryAfterMs));
  await db
    .prepare(
      "UPDATE discord_work_requests SET reason=?,next_attempt_at=? WHERE id=? AND scope_key=? AND state='pending' AND route_revision=? AND existing_event=?",
    )
    .bind(
      reason,
      new Date(now.getTime() + delay).toISOString(),
      request.id,
      workScopeKey(scope),
      request.route_revision,
      request.existing_event,
    )
    .run();
}

export async function reconcileWorkRouteRequest(db: Db, scope: WorkScope): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE discord_work_requests SET state=CASE (SELECT o.state FROM discord_work_operations o WHERE o.id=discord_work_requests.operation_id AND o.scope_key=discord_work_requests.scope_key)
    WHEN 'confirmed' THEN 'completed' WHEN 'superseded' THEN 'superseded' ELSE 'held' END,
    reason=(SELECT o.reason FROM discord_work_operations o WHERE o.id=discord_work_requests.operation_id AND o.scope_key=discord_work_requests.scope_key)
    WHERE id=(SELECT q.id FROM discord_work_requests q JOIN discord_work_operations o ON o.id=q.operation_id AND o.scope_key=q.scope_key WHERE q.scope_key=? AND ((q.state='processing' AND o.state IN ('confirmed','superseded','held','failed')) OR (q.state='held' AND o.state IN ('confirmed','superseded'))) ORDER BY q.created_at,q.id LIMIT 1)`,
    )
    .bind(workScopeKey(scope))
    .run();
  return result.meta.changes > 0;
}
