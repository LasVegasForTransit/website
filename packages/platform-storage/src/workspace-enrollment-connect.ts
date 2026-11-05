import { safeNext } from '@lasvegasfortransit/platform-core/web-auth';
import { digestToken, randomToken } from '@lasvegasfortransit/platform-core/random-token';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import type { AuthEnv } from './auth';

export const workspaceSessionHash = (env: AuthEnv, token: string) =>
  hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${token}`);
export const connectionHash = (token: string) => digestToken(`workspace-connect:${token}`);
export function onboardingOrigins(staff: string, member: string) {
  return (
    (staff === 'https://staff.lasvegasfortransit.org' &&
      member === 'https://lasvegasfortransit.org') ||
    (staff === 'https://staff-preview.lasvegasfortransit.org' &&
      member === 'https://preview.lasvegasfortransit.org')
  );
}
/** A live organization principal and its exact active Directory association. */
export const LIVE_ENROLLED_STAFF = `s.type='staff' AND s.expires_at>? AND p.deleted_at IS NULL
 AND e.state='active' AND (s.workspace_identity_id=e.identity_record_id OR
 EXISTS(SELECT 1 FROM staff_sso_links l WHERE l.id=s.sso_link_id AND l.person_id=p.id AND l.revoked_at IS NULL))`;
export async function beginWorkspaceConnection(
  env: AuthEnv,
  staffToken: string,
  input: { staffOrigin: string; memberOrigin: string; next?: string; now?: Date },
) {
  if (!onboardingOrigins(input.staffOrigin, input.memberOrigin)) return null;
  const now = input.now ?? new Date(),
    token = randomToken();
  await env.PLATFORM_DB.prepare(
    `INSERT INTO workspace_account_connections(token_hash,staff_session_hash,source_person_id,identity_record_id,sso_link_id,staff_origin,member_origin,return_to,expires_at)
    SELECT ?,s.id_hash,p.id,e.identity_record_id,s.sso_link_id,?,?,?,? FROM sessions s JOIN people p ON p.id=s.person_id
    JOIN workspace_enrollments e ON e.person_id=p.id WHERE s.id_hash=? AND e.provisional=1 AND ${LIVE_ENROLLED_STAFF}`,
  )
    .bind(
      await connectionHash(token),
      input.staffOrigin,
      input.memberOrigin,
      safeNext(input.next),
      new Date(now.getTime() + 600_000).toISOString(),
      await workspaceSessionHash(env, staffToken),
      now.toISOString(),
    )
    .run();
  return (await workspaceConnection(env, token, now)) ? token : null;
}
export async function workspaceConnection(env: AuthEnv, ticket: string, now = new Date()) {
  if (!/^[\w-]{43}$/.test(ticket)) return null;
  return env.PLATFORM_DB.prepare(
    `SELECT staff_origin,member_origin,return_to,source_person_id,destination_person_id
    FROM workspace_account_connections WHERE token_hash=? AND expires_at>? AND consumed_at IS NULL`,
  )
    .bind(await connectionHash(ticket), now.toISOString())
    .first<{
      return_to: string;
      staff_origin: string;
      member_origin: string;
      source_person_id: string;
      destination_person_id: string | null;
    }>();
}
export async function approveWorkspaceConnection(
  env: AuthEnv,
  ticket: string,
  memberToken: string,
  now = new Date(),
) {
  if (!/^[\w-]{43}$/.test(ticket)) return false;
  const memberHash = await workspaceSessionHash(env, memberToken);
  const approved = await env.PLATFORM_DB.prepare(
    `UPDATE workspace_account_connections SET member_session_hash=?,
    destination_person_id=(SELECT s.person_id FROM sessions s WHERE s.id_hash=?)
    WHERE token_hash=? AND expires_at>? AND consumed_at IS NULL AND member_session_hash IS NULL
    AND EXISTS(SELECT 1 FROM sessions m JOIN people p ON p.id=m.person_id JOIN person_keys k ON k.id=p.id
      WHERE m.id_hash=? AND m.type='member' AND m.expires_at>? AND p.deleted_at IS NULL AND k.erased_at IS NULL
      AND p.id<>workspace_account_connections.source_person_id) RETURNING token_hash`,
  )
    .bind(
      memberHash,
      memberHash,
      await connectionHash(ticket),
      now.toISOString(),
      memberHash,
      now.toISOString(),
    )
    .first();
  return Boolean(approved);
}
export async function completeWorkspaceConnection(
  env: AuthEnv,
  ticket: string,
  staffToken: string,
  now = new Date(),
): Promise<{ kind: 'connected' | 'conflict' | 'expired' }> {
  if (!/^[\w-]{43}$/.test(ticket)) return { kind: 'expired' };
  try {
    const row = await env.PLATFORM_DB.prepare(
      `UPDATE workspace_account_connections SET consumed_at=?
      WHERE token_hash=? AND staff_session_hash=? AND expires_at>? AND consumed_at IS NULL AND member_session_hash IS NOT NULL RETURNING token_hash`,
    )
      .bind(
        now.toISOString(),
        await connectionHash(ticket),
        await workspaceSessionHash(env, staffToken),
        now.toISOString(),
      )
      .first();
    return { kind: row ? 'connected' : 'expired' };
  } catch (error) {
    if (
      error instanceof Error &&
      /workspace_connection_conflict|UNIQUE constraint/.test(error.message)
    )
      return { kind: 'conflict' };
    throw error;
  }
}
