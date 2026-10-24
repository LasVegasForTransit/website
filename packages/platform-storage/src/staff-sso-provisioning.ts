import { WORKSPACE_DOMAIN } from '@lasvegasfortransit/platform-core/workspace-identity';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { AuthEnv } from './auth';
import type { SsoPrincipal } from './staff-sso';
import { TEAM_ACCOUNT_ELIGIBLE } from './staff-account';
/** Only an operator-confirmed provisioned Workspace identity may prepare an Access link. */
export async function prepareSsoLink(env: AuthEnv, principal: SsoPrincipal, now: Date) {
  const rows = await env.PLATFORM_DB.prepare(
    `SELECT i.person_id FROM identities i JOIN people p ON p.id=i.person_id WHERE i.platform='google_workspace' AND i.external_email=? AND i.link_method IN ('staff_confirmed','created_by_platform') AND p.deleted_at IS NULL AND ${TEAM_ACCOUNT_ELIGIBLE}`,
  )
    .bind(principal.email)
    .all<{ person_id: string }>();
  const [prepared] = rows.results;
  if (rows.results.length !== 1 || !prepared) return;
  await env.PLATFORM_DB.prepare(
    `INSERT INTO staff_sso_links(id,person_id,issuer,subject,email,created_at) SELECT ?,i.person_id,?,?,?,? FROM identities i JOIN people p ON p.id=i.person_id WHERE i.person_id=? AND i.platform='google_workspace' AND i.external_email=? AND i.link_method IN ('staff_confirmed','created_by_platform') AND p.deleted_at IS NULL AND ${TEAM_ACCOUNT_ELIGIBLE} AND NOT EXISTS(SELECT 1 FROM staff_sso_links prior WHERE prior.person_id=p.id OR prior.email=i.external_email) AND (SELECT count(*) FROM identities WHERE platform='google_workspace' AND external_email=? AND link_method IN ('staff_confirmed','created_by_platform'))=1 ON CONFLICT(issuer,subject) DO NOTHING`,
  )
    .bind(
      ulid(),
      principal.issuer,
      principal.subject,
      principal.email,
      now.toISOString(),
      prepared.person_id,
      principal.email,
      principal.email,
    )
    .run();
}
export function validSsoPrincipal(principal: SsoPrincipal, now: Date) {
  return Boolean(
    principal.issuer &&
    principal.subject &&
    principal.email.endsWith(`@${WORKSPACE_DOMAIN}`) &&
    Number.isFinite(principal.expiresAt.getTime()) &&
    principal.expiresAt > now,
  );
}
