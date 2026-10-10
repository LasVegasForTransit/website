import type { Db } from './db';
import { PERSON_OPERATION_ELIGIBLE } from './outbox';
export interface DiscordPlanInput {
  personId: string;
  guildId: string;
  memberRoleId: string;
  operationId?: string;
}
export interface DiscordRoleTarget {
  targetId: string;
  resourceId: string;
  generation: number;
  expectedAccess: boolean;
  current: boolean;
}
export interface DiscordPlan extends DiscordPlanInput {
  identityId: string;
  identityRecordId: string;
  identityEmail: string | null;
  managedRoleIds: string[];
  desiredRoleIds: string[];
  targets: DiscordRoleTarget[];
  revision: string;
  deletedAt: string | null;
}
interface IdentityRow {
  id: string;
  externalId: string;
  email: string | null;
  method: string;
}
interface RoleRow {
  targetId: string;
  resourceId: string;
  generation: number;
  expected: number;
  current: number;
}
interface PlanRow {
  deletedAt: string | null;
  membership: string;
  generation: number;
  identities: string;
  roles: string;
}
const ROLE_MAPPINGS = `SELECT committee_id,external_id FROM committee_account_mappings WHERE provider='discord'
  UNION SELECT id AS committee_id,discord_role_id AS external_id FROM committees WHERE discord_role_id IS NOT NULL`;
/** One statement gives a consistent identity, membership, assignment and registry snapshot. */
export async function loadDiscordPlan(
  db: Db,
  input: DiscordPlanInput,
): Promise<DiscordPlan | null> {
  const row = await db
    .prepare(
      `SELECT CASE WHEN p.deleted_at IS NOT NULL THEN 'not_member' ELSE p.membership_status END AS membership,p.deleted_at AS deletedAt,
    coalesce((SELECT generation FROM reconcile_generations WHERE person_id=p.id AND target_id='person'),0) AS generation,
    (SELECT json_group_array(json_object('id',id,'externalId',external_id,'email',external_email,'method',link_method)) FROM identities WHERE person_id=p.id AND platform='discord') AS identities,
    (SELECT json_group_array(json_object('targetId',r.committee_id,'resourceId',r.external_id,'generation',coalesce((SELECT generation FROM reconcile_generations WHERE person_id=p.id AND target_id=r.committee_id),0),
      'expected',CASE WHEN p.deleted_at IS NULL AND p.membership_status='member' AND c.discord_role_id=r.external_id AND EXISTS(SELECT 1 FROM committee_assignments a WHERE a.person_id=p.id AND a.committee_id=c.id AND a.ended_at IS NULL) THEN 1 ELSE 0 END,
      'current',CASE WHEN c.discord_role_id=r.external_id THEN 1 ELSE 0 END)) FROM (SELECT * FROM (${ROLE_MAPPINGS}) ORDER BY committee_id,external_id) r JOIN committees c ON c.id=r.committee_id) AS roles
    FROM reconciliation_people p WHERE p.id=? AND (p.deleted_at IS NULL OR EXISTS(
      SELECT 1 FROM integration_outbox o JOIN reconcile_generations g ON g.person_id=o.person_id AND g.target_id=o.target_id AND g.generation=o.generation
      WHERE o.id=? AND o.person_id=p.id AND o.state IN ('queued','running','retry') AND ${PERSON_OPERATION_ELIGIBLE}))`,
    )
    .bind(input.personId, input.operationId ?? null)
    .first<PlanRow>();
  if (!row) return null;
  const identities = JSON.parse(row.identities) as IdentityRow[];
  const roles = JSON.parse(row.roles) as RoleRow[];
  const identity = identities[0];
  if (
    identities.length !== 1 ||
    !identity ||
    !['self_linked', 'staff_confirmed'].includes(identity.method) ||
    input.memberRoleId === input.guildId ||
    roles.some(
      (role) => role.resourceId === input.memberRoleId || role.resourceId === input.guildId,
    )
  )
    return null;
  const targets: DiscordRoleTarget[] = [
    {
      targetId: 'person',
      resourceId: input.memberRoleId,
      generation: row.generation,
      expectedAccess: row.deletedAt === null && row.membership === 'member',
      current: true,
    },
    ...roles.map((role) => ({
      targetId: role.targetId,
      resourceId: role.resourceId,
      generation: role.generation,
      expectedAccess: Boolean(role.expected),
      current: Boolean(role.current),
    })),
  ];
  return {
    ...input,
    deletedAt: row.deletedAt,
    identityId: identity.externalId,
    identityRecordId: identity.id,
    identityEmail: identity.email,
    managedRoleIds: [...new Set(targets.map((target) => target.resourceId))].sort(),
    desiredRoleIds: [
      ...new Set(
        targets.filter((target) => target.expectedAccess).map((target) => target.resourceId),
      ),
    ].sort(),
    targets,
    revision: JSON.stringify([input.personId, input.guildId, input.memberRoleId, row]),
  };
}
export async function discordPlanIsCurrent(db: Db, plan: DiscordPlan): Promise<boolean> {
  const current = await loadDiscordPlan(db, {
    personId: plan.personId,
    guildId: plan.guildId,
    memberRoleId: plan.memberRoleId,
    ...(plan.operationId ? { operationId: plan.operationId } : {}),
  });
  return current?.revision === plan.revision;
}
