import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import type { WorkspaceEnrollment } from './workspace-enrollment';

export function workspaceStatus(enrollment: WorkspaceEnrollment, now = new Date()) {
  const active = enrollment.state === 'active';
  const fresh =
    enrollment.console_checked_at !== null &&
    Date.parse(enrollment.console_checked_at) <= now.getTime() &&
    Date.parse(enrollment.console_checked_at) > now.getTime() - 3600000;
  return {
    account: active ? 'Active Workspace account' : 'Workspace access paused',
    association: enrollment.provisional ? 'Separate team record' : 'Connected to this record',
    admission: consoleAdmission(enrollment, fresh),
    retry:
      enrollment.console_failure !== null || (!fresh && enrollment.console_checked_at !== null),
  };
}

function consoleAdmission(enrollment: WorkspaceEnrollment, fresh: boolean) {
  if (enrollment.console_failure) return 'Portal group update needs attention';
  if (fresh && enrollment.console_state === 'granted') return 'Portal group access confirmed';
  if (fresh && enrollment.console_state === 'absent') return 'Portal group access removed';
  if (enrollment.console_checked_at !== null && enrollment.console_state === 'granted')
    return 'Portal group access last confirmed';
  return 'Portal group access awaiting confirmation';
}

/** Request a fresh check without claiming access or clearing a provider-wide pause. */
export async function retryWorkspaceConsole(
  db: Db,
  actor: Actor,
  personId: string,
  now = new Date(),
) {
  const auditId = ulid();
  await db.batch([
    db
      .prepare(
        `UPDATE workspace_directory_accounts SET console_due_at=?,console_failure=NULL
      WHERE identity_record_id IN (SELECT id FROM identities WHERE person_id=?) AND (console_failure IS NOT NULL OR console_checked_at<=?)
      AND (console_lease_until IS NULL OR console_lease_until<=?) AND ${STAFF_ADMIN_SCOPE}`,
      )
      .bind(
        now.toISOString(),
        personId,
        new Date(now.getTime() - 3600000).toISOString(),
        now.toISOString(),
        actor.personId,
      ),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,occurred_at)
      SELECT ?,?,'access.retry',?,json_object('system','google_group','source','workspace_onboarding'),? WHERE changes()>0`,
      )
      .bind(auditId, actor.personId, personId, now.toISOString()),
  ]);
  return Boolean(await db.prepare('SELECT 1 FROM staff_audits WHERE id=?').bind(auditId).first());
}

export async function workspaceScopeReviews(db: Db, actor: Actor) {
  return (
    await db
      .prepare(
        `SELECT email,observed_at AS observedAt FROM workspace_directory_accounts
   WHERE state='review' AND ${STAFF_ADMIN_SCOPE} ORDER BY observed_at DESC,id LIMIT 51`,
      )
      .bind(actor.personId)
      .all<{ email: string | null; observedAt: string }>()
  ).results;
}
