import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import type { WorkspaceIdentity } from '@lasvegasfortransit/platform-core/workspace-identity';
import { createSession, endSession, readSession, type AuthEnv } from './auth';
export async function createWorkspaceSession(
  env: AuthEnv,
  workspace: WorkspaceIdentity,
  now: Date = new Date(),
) {
  const identity = await env.PLATFORM_DB.prepare(
    `SELECT i.id, i.person_id FROM identities i JOIN people p ON p.id = i.person_id
     WHERE i.platform = 'google_workspace' AND i.external_id = ? AND p.deleted_at IS NULL AND p.membership_status = 'member'`,
  )
    .bind(workspace.subject)
    .first<{ id: string; person_id: string }>();
  if (!identity) return null;
  const session = await createSession(env, identity.person_id, 'staff', now);
  await env.PLATFORM_DB.batch([
    env.PLATFORM_DB.prepare(
      `UPDATE sessions SET workspace_identity_id = ? WHERE id_hash = ?
      AND EXISTS (SELECT 1 FROM people WHERE id = sessions.person_id AND deleted_at IS NULL AND membership_status = 'member')`,
    ).bind(identity.id, await hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${session.token}`)),
    env.PLATFORM_DB.prepare(
      'UPDATE identities SET external_email = ?, updated_at = ? WHERE id = ?',
    ).bind(workspace.email, now.toISOString(), identity.id),
  ]);
  if (await readWorkspaceSession(env, session.token, now)) return session;
  await endSession(env, session.token);
  return null;
}

export async function readWorkspaceSession(env: AuthEnv, token: string, now: Date = new Date()) {
  const session = await readSession(env, token, now);
  if (session?.type !== 'staff') return null;
  const identity = await env.PLATFORM_DB.prepare(
    `SELECT i.external_id, i.external_email FROM sessions s JOIN identities i
       ON i.id = s.workspace_identity_id AND i.person_id = s.person_id
     JOIN people p ON p.id = s.person_id AND p.deleted_at IS NULL AND p.membership_status = 'member'
     WHERE s.id_hash = ? AND i.platform = 'google_workspace'`,
  )
    .bind(await hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${token}`))
    .first<{ external_id: string; external_email: string }>();
  return identity
    ? {
        ...session,
        workspaceSubject: identity.external_id,
        workspaceEmail: identity.external_email,
      }
    : null;
}
