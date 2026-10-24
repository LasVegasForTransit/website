import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import type { AuthEnv } from './auth';

/** Only explicit team account enrollment permits a non-newsletter member to sign in as staff. */
export const TEAM_ACCOUNT_ELIGIBLE = `(p.membership_status='member' OR (p.membership_status='not_member' AND EXISTS(SELECT 1 FROM staff_team_accounts t WHERE t.person_id=p.id)))`;

export async function createTeamAccount(
  env: AuthEnv,
  mode: 'google' | 'cloudflare-access',
  token: string,
  input: { givenName: string; familyName: string; now: Date },
): Promise<string | null> {
  const now = input.now;
  const given = input.givenName.trim(),
    family = input.familyName.trim();
  if (!given || given.length > 100 || family.length > 100) return null;
  const table = mode === 'google' ? 'workspace_pending_links' : 'staff_sso_pending';
  const pendingHash = await hashWithSecret(
    env.LVBT_SIGN_IN_SECRET,
    `${mode === 'google' ? 'workspace-link' : 'sso-link'}:${token}`,
  );
  const principalMissing =
    mode === 'google'
      ? `NOT EXISTS(SELECT 1 FROM identities i WHERE i.platform='google_workspace' AND (i.external_id=q.workspace_subject OR i.external_email=q.workspace_email))`
      : `NOT EXISTS(SELECT 1 FROM staff_sso_links l WHERE l.issuer=q.issuer AND (l.subject=q.subject OR l.email=q.workspace_email)) AND NOT EXISTS(SELECT 1 FROM identities i WHERE i.platform='google_workspace' AND i.external_email=q.workspace_email)`;
  const guard = `q.token_hash=? AND q.expires_at>? AND ${principalMissing} AND NOT EXISTS(SELECT 1 FROM people WHERE email=q.workspace_email)`;
  const id = ulid(),
    stamp = now.toISOString();
  await env.PLATFORM_DB.batch([
    env.PLATFORM_DB.prepare(
      `INSERT INTO people(id,given_name,family_name,email,email_verified_at,created_at,updated_at) SELECT ?,?,?,q.workspace_email,?,?,? FROM ${table} q WHERE ${guard}`,
    ).bind(id, given, family || null, stamp, stamp, stamp, pendingHash, stamp),
    env.PLATFORM_DB.prepare(
      'INSERT INTO staff_team_accounts(person_id,created_at) SELECT id,? FROM people WHERE id=?',
    ).bind(stamp, id),
    ...['given_name', 'family_name', 'email'].map((field) =>
      env.PLATFORM_DB.prepare(
        `INSERT INTO field_sources(person_id,field,source,confirmed_at,created_at,updated_at) SELECT id,?,'member',?,?,? FROM people WHERE id=?`,
      ).bind(field, stamp, stamp, stamp, id),
    ),
    mode === 'google'
      ? env.PLATFORM_DB.prepare(
          `INSERT INTO identities(id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at) SELECT ?,?,'google_workspace',q.workspace_subject,q.workspace_email,?,'self_linked',?,? FROM ${table} q WHERE q.token_hash=? AND EXISTS(SELECT 1 FROM people WHERE id=?)`,
        ).bind(ulid(), id, stamp, stamp, stamp, pendingHash, id)
      : env.PLATFORM_DB.prepare(
          `INSERT INTO staff_sso_links(id,person_id,issuer,subject,email,created_at) SELECT ?,?,q.issuer,q.subject,q.workspace_email,? FROM ${table} q WHERE q.token_hash=? AND EXISTS(SELECT 1 FROM people WHERE id=?)`,
        ).bind(ulid(), id, stamp, pendingHash, id),
    env.PLATFORM_DB.prepare(
      `DELETE FROM ${table} WHERE token_hash=? AND EXISTS(SELECT 1 FROM staff_team_accounts WHERE person_id=?)`,
    ).bind(pendingHash, id),
  ]);
  return (await env.PLATFORM_DB.prepare('SELECT 1 FROM staff_team_accounts WHERE person_id=?')
    .bind(id)
    .first())
    ? id
    : null;
}
