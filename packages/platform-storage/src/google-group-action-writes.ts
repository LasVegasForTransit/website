import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, Statement } from './db';
import { googleGroupActionGuard, type GoogleGroupAction } from './google-group-action-guard';
export function googleGroupActionPayload(input: GoogleGroupAction): string {
  return JSON.stringify({
    personId: input.personId,
    groupEmail: input.groupEmail,
    identityId: input.identityId,
    expectedSnapshot: input.expectedSnapshot,
    expectedAccess: input.expectedAccess,
    customerId: input.configuration.contextId,
    source: 'google_group_review',
  });
}
export function googleGroupRequestWrites(
  db: Db,
  actor: Actor,
  input: GoogleGroupAction,
  now: Date,
): Statement[] {
  const stamp = now.toISOString(),
    payload = googleGroupActionPayload(input);
  const guard = googleGroupActionGuard(actor, input, now);
  const fresh = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND kind='access.group_update' AND target_id=? AND payload=? AND applied_at IS NULL)`;
  const values = [input.operationId, actor.personId, input.personId, payload];
  return [
    db
      .prepare(
        `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at,result)
      SELECT ?,?,'access.group_update',?,?,?,json_object('personId',?,'groupEmail',?) WHERE ${guard.sql}
      AND NOT EXISTS(SELECT 1 FROM integration_outbox WHERE id=?) ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        input.operationId,
        actor.personId,
        input.personId,
        payload,
        stamp,
        input.personId,
        input.groupEmail,
        ...guard.values,
        input.operationId,
      ),
    db
      .prepare(
        `INSERT INTO reconcile_generations(person_id,target_id,generation) SELECT ?,'person',1 WHERE ${fresh}
      ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1`,
      )
      .bind(input.personId, ...values),
    db
      .prepare(
        `INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      SELECT ?,'person_reconcile',?,'person',g.generation,?,?,?,? FROM reconcile_generations g WHERE g.person_id=? AND g.target_id='person' AND ${fresh}`,
      )
      .bind(
        input.operationId,
        input.personId,
        payload,
        stamp,
        stamp,
        stamp,
        input.personId,
        ...values,
      ),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT ?,?,'access.group_update',?,json_object('provider','google_workspace','source','google_group_review','reason',?,
        'resourceId',?,'targetId',(SELECT committee_id FROM committee_account_mappings WHERE provider='google_workspace' AND external_id=?
          UNION SELECT id FROM committees WHERE workspace_group_email=? LIMIT 1)),?,? WHERE ${fresh}`,
      )
      .bind(
        ulid(),
        actor.personId,
        input.personId,
        input.expectedAccess ? 'missing_access' : 'unexpected_access',
        input.groupEmail,
        input.groupEmail,
        input.groupEmail,
        input.operationId,
        stamp,
        ...values,
      ),
    db
      .prepare(`UPDATE staff_operations SET applied_at=? WHERE operation_id=? AND ${fresh}`)
      .bind(stamp, input.operationId, ...values),
  ];
}
