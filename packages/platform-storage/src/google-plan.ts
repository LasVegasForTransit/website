import type { Db, SqlValue } from './db';
import { PERSON_OPERATION_ELIGIBLE } from './outbox';
export interface GoogleTarget {
  targetId: string;
  resourceId: string;
  generation: number;
  expectedAccess: boolean;
  current: boolean;
}
export interface GooglePlan {
  personId: string;
  operationId: string;
  customerId: string;
  identityId: string;
  identityRecordId: string;
  identityEmail: string | null;
  deletedAt: string | null;
  snapshot: string;
  revision: string;
  targets: GoogleTarget[];
  groups: { resourceId: string; desired: boolean }[];
}
const MAPPINGS = `SELECT committee_id,external_id FROM committee_account_mappings WHERE provider='google_workspace'
  UNION SELECT id,workspace_group_email FROM committees WHERE workspace_group_email IS NOT NULL`;
/** A single SQL snapshot also serves as the atomic conditional-write guard. */
const SNAPSHOT = `SELECT json_object('deletedAt',p.deleted_at,'membership',CASE WHEN p.deleted_at IS NULL THEN p.membership_status ELSE 'not_member' END,
  'generation',coalesce((SELECT generation FROM reconcile_generations WHERE person_id=p.id AND target_id='person'),0),
  'identities',json((SELECT json_group_array(json_object('id',id,'externalId',external_id,'email',external_email,'method',link_method)) FROM (SELECT * FROM identities WHERE person_id=p.id AND platform='google_workspace' ORDER BY id))),
  'targets',json((SELECT json_group_array(json_object('targetId',r.committee_id,'resourceId',r.external_id,'generation',coalesce((SELECT generation FROM reconcile_generations WHERE person_id=p.id AND target_id=r.committee_id),0),
    'expected',CASE WHEN p.deleted_at IS NULL AND p.membership_status='member' AND c.workspace_group_email=r.external_id AND EXISTS(SELECT 1 FROM committee_assignments a WHERE a.person_id=p.id AND a.committee_id=c.id AND a.ended_at IS NULL) THEN 1 ELSE 0 END,
    'current',CASE WHEN c.workspace_group_email=r.external_id THEN 1 ELSE 0 END)) FROM (SELECT * FROM (${MAPPINGS}) ORDER BY committee_id,external_id) r JOIN committees c ON c.id=r.committee_id))) AS snapshot
  FROM reconciliation_people p WHERE p.id=? AND EXISTS(SELECT 1 FROM integration_outbox o JOIN reconcile_generations g ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation
    WHERE o.id=? AND o.person_id=p.id AND o.kind IN ('person_reconcile','committee_reconcile') AND o.state IN ('queued','running','retry') AND ${PERSON_OPERATION_ELIGIBLE})`;
interface Snapshot {
  deletedAt: string | null;
  identities: { id: string; externalId: string; email: string | null; method: string }[];
  targets: {
    targetId: string;
    resourceId: string;
    generation: number;
    expected: number;
    current: number;
  }[];
}
export async function loadGooglePlan(
  db: Db,
  input: { personId: string; operationId: string; customerId: string },
): Promise<GooglePlan | null> {
  const row = await db
    .prepare(SNAPSHOT)
    .bind(input.personId, input.operationId)
    .first<{ snapshot: string }>();
  if (!row) return null;
  const snapshot = JSON.parse(row.snapshot) as Snapshot;
  const identity = snapshot.identities[0];
  if (
    snapshot.identities.length !== 1 ||
    !identity ||
    !['self_linked', 'staff_confirmed'].includes(identity.method)
  )
    return null;
  const targets = snapshot.targets.map((target) => ({
    targetId: target.targetId,
    resourceId: target.resourceId,
    generation: target.generation,
    expectedAccess: Boolean(target.expected),
    current: Boolean(target.current),
  }));
  const groups = [...new Set(targets.map((target) => target.resourceId))]
    .map((resourceId) => ({
      resourceId,
      desired: targets.some((target) => target.resourceId === resourceId && target.expectedAccess),
    }))
    .sort(
      (a, b) => Number(a.desired) - Number(b.desired) || a.resourceId.localeCompare(b.resourceId),
    );
  return {
    ...input,
    identityId: identity.externalId,
    identityRecordId: identity.id,
    identityEmail: identity.email,
    deletedAt: snapshot.deletedAt,
    snapshot: row.snapshot,
    revision: JSON.stringify([input.customerId, row.snapshot]),
    targets,
    groups,
  };
}
export function googlePlanGuard(plan: GooglePlan): { sql: string; values: SqlValue[] } {
  return { sql: `(${SNAPSHOT})=?`, values: [plan.personId, plan.operationId, plan.snapshot] };
}
export async function googlePlanIsCurrent(db: Db, plan: GooglePlan): Promise<boolean> {
  const guard = googlePlanGuard(plan);
  return Boolean(
    await db
      .prepare(`SELECT 1 WHERE ${guard.sql}`)
      .bind(...guard.values)
      .first(),
  );
}
