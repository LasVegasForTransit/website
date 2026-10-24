import { ulid } from '@lasvegasfortransit/platform-core/ids';
import {
  createSsoSession,
  type SsoPrincipal,
} from '@lasvegasfortransit/platform-storage/staff-sso';
import type { AuthEnv } from '@lasvegasfortransit/platform-storage/auth';
/** Seed an already-confirmed fictional principal for tests unrelated to enrollment. */
export async function ssoSessionFixture(env: AuthEnv, personId: string, principal: SsoPrincipal) {
  await env.PLATFORM_DB.prepare(
    'INSERT INTO staff_sso_links(id,person_id,issuer,subject,email,created_at) VALUES(?,?,?,?,?,?)',
  )
    .bind(
      ulid(),
      personId,
      principal.issuer,
      principal.subject,
      principal.email,
      new Date().toISOString(),
    )
    .run();
  const session = await createSsoSession(env, principal);
  if (!session) throw new Error('Fixture SSO session unavailable');
  return session;
}
export function ssoPrincipalFixture(email: string, subject: string): SsoPrincipal {
  return {
    email,
    subject,
    issuer: 'https://lvbt.cloudflareaccess.com',
    expiresAt: new Date(Date.now() + 3600000),
  };
}
