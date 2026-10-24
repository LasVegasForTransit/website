import { TEAM_ACCOUNT_ELIGIBLE } from './staff-account';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import type { AuthEnv } from './auth';
type Mode = 'google' | 'cloudflare-access';
const hash = (env: AuthEnv, purpose: string, value: string) =>
  hashWithSecret(env.LVBT_SIGN_IN_SECRET, `${purpose}:${value}`);
export async function verifiedMemberProof(env: AuthEnv, sessionHash: string, now = new Date()) {
  return env.PLATFORM_DB.prepare(
    `SELECT p.id,p.email FROM sessions s JOIN people p ON p.id=s.person_id WHERE s.id_hash=? AND s.type='member' AND s.expires_at>? AND p.deleted_at IS NULL AND ${TEAM_ACCOUNT_ELIGIBLE}`,
  )
    .bind(sessionHash, now.toISOString())
    .first<{ id: string; email: string }>();
}
export async function beginMemberHandoff(
  env: AuthEnv,
  pending: string,
  input: { mode: Mode; staffOrigin: string; now?: Date },
) {
  const { mode, staffOrigin } = input,
    now = input.now ?? new Date();
  const origin = new URL(staffOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== staffOrigin)
    throw new Error('Invalid staff origin');
  const token = randomToken();
  await env.PLATFORM_DB.prepare(
    'INSERT INTO staff_member_handoffs(token_hash,pending_hash,auth_mode,staff_origin,expires_at) VALUES(?,?,?,?,?)',
  )
    .bind(
      await hash(env, 'staff-handoff', token),
      await hash(env, mode === 'google' ? 'workspace-link' : 'sso-link', pending),
      mode,
      staffOrigin,
      new Date(now.getTime() + 600000).toISOString(),
    )
    .run();
  return token;
}
export async function memberHandoff(env: AuthEnv, token: string, now = new Date()) {
  if (!/^[\w-]{43}$/.test(token)) return null;
  return env.PLATFORM_DB.prepare(
    'SELECT pending_hash,auth_mode,staff_origin,member_session_hash,person_id FROM staff_member_handoffs WHERE token_hash=? AND expires_at>?',
  )
    .bind(await hash(env, 'staff-handoff', token), now.toISOString())
    .first<{
      pending_hash: string;
      auth_mode: Mode;
      staff_origin: string;
      member_session_hash: string | null;
      person_id: string | null;
    }>();
}
export async function approveMemberHandoff(
  env: AuthEnv,
  token: string,
  memberToken: string,
  now = new Date(),
) {
  const sessionHash = await hash(env, 'session', memberToken);
  const member = await verifiedMemberProof(env, sessionHash, now);
  if (!member) return false;
  const result = await env.PLATFORM_DB.prepare(
    `UPDATE staff_member_handoffs SET member_session_hash=?,person_id=? WHERE token_hash=? AND expires_at>? AND member_session_hash IS NULL`,
  )
    .bind(sessionHash, member.id, await hash(env, 'staff-handoff', token), now.toISOString())
    .run();
  return result.meta.changes === 1;
}
export async function staffHandoffProof(
  env: AuthEnv,
  token: string,
  input: { pending: string; mode: Mode; now?: Date },
) {
  const { pending, mode } = input,
    now = input.now ?? new Date();
  const handoff = await memberHandoff(env, token, now);
  if (
    !handoff?.member_session_hash ||
    handoff.auth_mode !== mode ||
    handoff.pending_hash !==
      (await hash(env, mode === 'google' ? 'workspace-link' : 'sso-link', pending))
  )
    return null;
  const member = await verifiedMemberProof(env, handoff.member_session_hash, now);
  return member ? { ...member, sessionHash: handoff.member_session_hash } : null;
}
