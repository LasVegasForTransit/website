import { can } from '@lasvegasfortransit/platform-core/permissions';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { loadActor } from './staff-roles';
import { auditDenied } from './audits';
import { assignmentMutation } from './committee-mutations';

export type AssignmentRole = 'member' | 'lead';
export type AssignmentEndReason = 'stepped_back' | 'moved' | 'left_lvbt' | 'removed';
export interface Assignment {
  id: string;
  personId: string;
  committeeId: string;
  role: AssignmentRole;
  startedAt: string;
  endedAt: string | null;
  endReason: AssignmentEndReason | null;
}
export interface AssignmentRow {
  id: string;
  person_id: string;
  committee_id: string;
  role: AssignmentRole;
  started_at: string;
  ended_at: string | null;
  end_reason: AssignmentEndReason | null;
}
export function assignment(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    personId: row.person_id,
    committeeId: row.committee_id,
    role: row.role,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
  };
}

export class CommitteeService {
  constructor(private readonly db: Db) {}
  async assign(input: {
    personId: string;
    committeeId: string;
    role: AssignmentRole;
    actorId: string;
    operationId: string;
    fromWelcome?: true;
  }): Promise<MutationResult<Assignment>> {
    const { personId, committeeId, role, actorId, operationId } = input;
    if (!(await this.allowed(actorId, committeeId))) return { kind: 'forbidden' };
    if (!['member', 'lead'].includes(role) || !operationId) return { kind: 'invalid' };
    return await assignmentMutation(this.db, {
      kind: 'assign',
      id: ulid(),
      personId,
      committeeId,
      role,
      actorId,
      operationId,
      ...(input.fromWelcome ? { fromWelcome: true } : {}),
    });
  }
  async changeRole(
    assignmentId: string,
    role: AssignmentRole,
    actorId: string,
    operationId: string,
  ): Promise<MutationResult<Assignment>> {
    const current = await this.find(assignmentId);
    // Match the denial for unknown and hidden assignments; do not disclose existence.
    if (!current) {
      await auditDenied(this.db, actorId, 'committee.assign');
      return { kind: 'forbidden' };
    }
    if (!(await this.allowed(actorId, current.committee_id))) return { kind: 'forbidden' };
    if (!['member', 'lead'].includes(role) || !operationId) return { kind: 'invalid' };
    return await assignmentMutation(this.db, {
      kind: 'change',
      id: assignmentId,
      personId: current.person_id,
      committeeId: current.committee_id,
      role,
      actorId,
      operationId,
    });
  }
  async endAssignment(
    assignmentId: string,
    reason: AssignmentEndReason,
    actorId: string,
    operationId: string,
  ): Promise<MutationResult<Assignment>> {
    const current = await this.find(assignmentId);
    if (!current) {
      await auditDenied(this.db, actorId, 'committee.assign');
      return { kind: 'forbidden' };
    }
    if (!(await this.allowed(actorId, current.committee_id))) return { kind: 'forbidden' };
    if (!['stepped_back', 'moved', 'left_lvbt', 'removed'].includes(reason) || !operationId)
      return { kind: 'invalid' };
    return await assignmentMutation(this.db, {
      kind: 'end',
      id: assignmentId,
      personId: current.person_id,
      committeeId: current.committee_id,
      role: current.role,
      reason,
      actorId,
      operationId,
    });
  }
  async endForAdministrator(input: {
    assignmentId: string;
    reason: AssignmentEndReason;
    actorId: string;
    operationId: string;
  }): Promise<MutationResult<Assignment>> {
    const actor = await loadActor(this.db, input.actorId);
    if (!actor || !can(actor, 'access.recover')) {
      await auditDenied(this.db, input.actorId, 'access.recover');
      return { kind: 'forbidden' };
    }
    const current = await this.find(input.assignmentId);
    if (!current) return { kind: 'forbidden' };
    if (
      !['stepped_back', 'moved', 'left_lvbt', 'removed'].includes(input.reason) ||
      !input.operationId ||
      input.operationId.length > 200
    )
      return { kind: 'invalid' };
    return await assignmentMutation(this.db, {
      kind: 'end',
      id: current.id,
      personId: current.person_id,
      committeeId: current.committee_id,
      role: current.role,
      reason: input.reason,
      actorId: input.actorId,
      operationId: input.operationId,
      administratorsOnly: true,
    });
  }
  private async allowed(actorId: string, committeeId: string): Promise<boolean> {
    const actor = await loadActor(this.db, actorId);
    if (actor && can(actor, 'committee.assign', { committeeId })) return true;
    await auditDenied(this.db, actorId, 'committee.assign');
    return false;
  }
  private find(id: string) {
    return this.db
      .prepare('SELECT * FROM committee_assignments WHERE id=?')
      .bind(id)
      .first<AssignmentRow>();
  }
}
