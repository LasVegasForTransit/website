import { ulid } from '@lasvegasfortransit/platform-core/ids';
import {
  WORKSPACE_DOMAIN,
  type WorkspaceIdentity,
} from '@lasvegasfortransit/platform-core/workspace-identity';
import type { Db } from './db';
export async function linkWorkspaceIdentity(
  db: Db,
  input: {
    workspace: WorkspaceIdentity;
    personId: string;
    method: 'self_linked' | 'staff_confirmed' | 'created_by_platform';
    operationId: string;
  },
): Promise<
  { kind: 'ok'; value: { personId: string } } | { kind: 'conflict' | 'invalid' | 'not_found' }
> {
  if (
    !input.workspace.subject ||
    !input.operationId ||
    !input.workspace.email.endsWith(`@${WORKSPACE_DOMAIN}`)
  )
    return { kind: 'invalid' };
  const person = await db
    .prepare(
      "SELECT id FROM people WHERE id = ? AND deleted_at IS NULL AND membership_status = 'member'",
    )
    .bind(input.personId)
    .first();
  if (!person) return { kind: 'not_found' };
  const stamp = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO identities (id, person_id, platform, external_id, external_email, linked_at, link_method, created_at, updated_at)
       SELECT ?, ?, 'google_workspace', ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM people WHERE id = ? AND deleted_at IS NULL AND membership_status = 'member')
         AND NOT EXISTS (SELECT 1 FROM workspace_link_operations WHERE operation_id = ?
           AND (person_id != ? OR workspace_subject != ?))
       ON CONFLICT (platform, external_id) DO NOTHING`,
      )
      .bind(
        ulid(),
        input.personId,
        input.workspace.subject,
        input.workspace.email,
        stamp,
        input.method,
        stamp,
        stamp,
        input.personId,
        input.operationId,
        input.personId,
        input.workspace.subject,
      ),
    db
      .prepare(
        `INSERT INTO workspace_link_operations (operation_id, person_id, workspace_subject, created_at)
       SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM identities
         WHERE platform = 'google_workspace' AND external_id = ? AND person_id = ?)
       ON CONFLICT (operation_id) DO NOTHING`,
      )
      .bind(
        input.operationId,
        input.personId,
        input.workspace.subject,
        stamp,
        input.workspace.subject,
        input.personId,
      ),
  ]);
  const linked = await db
    .prepare(
      `SELECT i.person_id FROM identities i JOIN workspace_link_operations o ON o.person_id = i.person_id
       AND o.workspace_subject = i.external_id
     JOIN people p ON p.id = i.person_id AND p.deleted_at IS NULL AND p.membership_status = 'member'
     WHERE i.platform = 'google_workspace' AND i.external_id = ? AND i.person_id = ? AND o.operation_id = ?`,
    )
    .bind(input.workspace.subject, input.personId, input.operationId)
    .first<{ person_id: string }>();
  return linked ? { kind: 'ok', value: { personId: linked.person_id } } : { kind: 'conflict' };
}
