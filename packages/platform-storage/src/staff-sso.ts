import { validSsoPrincipal as valid, prepareSsoLink } from './staff-sso-provisioning';
import { verifiedMemberProof } from './staff-member-handoff';
import { createTeamAccount, TEAM_ACCOUNT_ELIGIBLE } from './staff-account';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import {
  checkCode,
  requestCode,
  createSession,
  readSession,
  endSession,
  type AuthEnv,
} from './auth';
import type { Db } from './db';
import { normalizeEmail } from './person-service';
import type { WorkspaceCompletion } from './workspace-pending';
import { approvedDestinations } from './workspace-state';
export interface SsoPrincipal {
  issuer: string;
  subject: string;
  email: string;
  expiresAt: Date;
}
async function hash(env: AuthEnv, purpose: string, token: string) {
  return await hashWithSecret(env.LVBT_SIGN_IN_SECRET, `${purpose}:${token}`);
}
export async function createSsoSession(env: AuthEnv, principal: SsoPrincipal, now = new Date()) {
  if (!valid(principal, now)) return null;
  await prepareSsoLink(env, principal, now);
  const link = await env.PLATFORM_DB.prepare(
    `SELECT l.id,l.person_id FROM staff_sso_links l JOIN people p ON p.id=l.person_id WHERE l.issuer=? AND l.subject=? AND l.revoked_at IS NULL AND p.deleted_at IS NULL AND ${TEAM_ACCOUNT_ELIGIBLE}`,
  )
    .bind(principal.issuer, principal.subject)
    .first<{ id: string; person_id: string }>();
  if (!link) return null;
  const session = await createSession(env, link.person_id, 'staff', now);
  session.expiresAt = new Date(
    Math.min(session.expiresAt.getTime(), principal.expiresAt.getTime()),
  );
  await env.PLATFORM_DB.prepare(
    "UPDATE sessions SET sso_link_id=?,authentication_source='cloudflare-access',expires_at=? WHERE id_hash=?",
  )
    .bind(link.id, session.expiresAt.toISOString(), await hash(env, 'session', session.token))
    .run();
  if (await readSsoSession(env, session.token, principal, now)) return session;
  await endSession(env, session.token);
  return null;
}
export async function readSsoSession(
  env: AuthEnv,
  token: string,
  principal: SsoPrincipal,
  now = new Date(),
) {
  if (!valid(principal, now)) return null;
  const session = await readSession(env, token, now);
  if (session?.type !== 'staff' || session.person.membershipStatus === 'former_member') return null;
  const link = await env.PLATFORM_DB.prepare(
    `SELECT 1 FROM sessions s JOIN staff_sso_links l ON l.id=s.sso_link_id AND l.person_id=s.person_id WHERE s.id_hash=? AND s.authentication_source='cloudflare-access' AND l.issuer=? AND l.subject=? AND l.revoked_at IS NULL`,
  )
    .bind(await hash(env, 'session', token), principal.issuer, principal.subject)
    .first();
  return link ? { ...session, principal } : null;
}
export async function revokeSsoPrincipal(
  db: Db,
  principal: Pick<SsoPrincipal, 'issuer' | 'subject'>,
  now = new Date(),
) {
  await db
    .prepare(
      'UPDATE staff_sso_links SET revoked_at=coalesce(revoked_at,?),email=NULL WHERE issuer=? AND subject=?',
    )
    .bind(now.toISOString(), principal.issuer, principal.subject)
    .run();
}
interface Pending {
  issuer: string;
  subject: string;
  workspace_email: string;
  return_to: string;
  expires_at: string;
  principal_expires_at: string;
}
export class SsoLinkService {
  constructor(private readonly env: AuthEnv) {}
  private tokenHash(token: string) {
    return hash(this.env, 'sso-link', token);
  }
  async begin(principal: SsoPrincipal, input: { returnTo: string; now?: Date }): Promise<string> {
    const now = input.now ?? new Date();
    approvedDestinations(input.returnTo, 'https://lasvegasfortransit.org/sign-in/google/callback');
    if (!valid(principal, now)) throw new Error('SSO principal expired or invalid');
    const revoked = await this.env.PLATFORM_DB.prepare(
      'SELECT 1 FROM staff_sso_links WHERE issuer=? AND subject=? AND revoked_at IS NOT NULL',
    )
      .bind(principal.issuer, principal.subject)
      .first();
    if (revoked) throw new Error('SSO principal revoked');
    const token = randomToken();
    await this.env.PLATFORM_DB.prepare(
      `INSERT INTO staff_sso_pending(token_hash,issuer,subject,workspace_email,return_to,principal_expires_at,expires_at) VALUES(?,?,?,?,?,?,?)`,
    )
      .bind(
        await this.tokenHash(token),
        principal.issuer,
        principal.subject,
        principal.email,
        input.returnTo,
        principal.expiresAt.toISOString(),
        new Date(
          Math.min(now.getTime() + 15 * 60_000, principal.expiresAt.getTime()),
        ).toISOString(),
      )
      .run();
    return token;
  }
  async pending(token: string, now = new Date()) {
    if (!/^[\w-]{43}$/.test(token)) return null;
    const pending = await this.env.PLATFORM_DB.prepare(
      `SELECT issuer,subject,workspace_email,return_to,principal_expires_at,expires_at FROM staff_sso_pending p WHERE token_hash=? AND expires_at>? AND NOT EXISTS(SELECT 1 FROM staff_sso_links l WHERE l.issuer=p.issuer AND l.subject=p.subject AND l.revoked_at IS NOT NULL)`,
    )
      .bind(await this.tokenHash(token), now.toISOString())
      .first<Pending>();
    return pending
      ? {
          ...pending,
          email: pending.workspace_email,
          expiresAt: new Date(pending.principal_expires_at),
        }
      : null;
  }
  async requestCode(token: string, input: { email: string; callerAddress: string; now?: Date }) {
    if (!(await this.pending(token, input.now))) return { kind: 'expired' } as const;
    return await requestCode(this.env, {
      ...input,
      purpose: 'workspace_link',
      workspaceLinkId: await this.tokenHash(token),
    });
  }
  async createAccount(
    token: string,
    input: { givenName: string; familyName: string; now?: Date },
  ): Promise<WorkspaceCompletion> {
    const now = input.now ?? new Date();
    const pending = await this.pending(token, now);
    if (!pending) return { kind: 'expired' };
    const personId = await createTeamAccount(this.env, 'cloudflare-access', token, {
      ...input,
      now,
    });
    if (!personId) return { kind: 'conflict' };
    const session = await createSsoSession(
      this.env,
      {
        issuer: pending.issuer,
        subject: pending.subject,
        email: pending.workspace_email,
        expiresAt: pending.expiresAt,
      },
      now,
    );
    return session
      ? { kind: 'ok', personId, returnTo: pending.return_to, session }
      : { kind: 'conflict' };
  }
  async completeForMember(
    token: string,
    memberToken: string,
    now = new Date(),
  ): Promise<WorkspaceCompletion> {
    return this.completeForMemberProof(
      token,
      await hashWithSecret(this.env.LVBT_SIGN_IN_SECRET, `session:${memberToken}`),
      now,
    );
  }
  async completeForMemberProof(
    token: string,
    sessionHash: string,
    now = new Date(),
  ): Promise<WorkspaceCompletion> {
    const member = await verifiedMemberProof(this.env, sessionHash, now);
    return member
      ? this.finishMember(token, { personId: member.id, sessionHash }, now)
      : { kind: 'conflict' };
  }
  private async finishMember(
    token: string,
    proof: { personId: string; sessionHash: string },
    now: Date,
  ): Promise<WorkspaceCompletion> {
    const { personId, sessionHash } = proof;
    const pending = await this.env.PLATFORM_DB.prepare(
      'DELETE FROM staff_sso_pending WHERE token_hash=? AND expires_at>? RETURNING issuer,subject,workspace_email,return_to,principal_expires_at,expires_at',
    )
      .bind(await this.tokenHash(token), now.toISOString())
      .first<Pending>();
    if (!pending) return { kind: 'expired' };
    await this.env.PLATFORM_DB.prepare(
      `INSERT INTO staff_sso_links(id,person_id,issuer,subject,email,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND ${TEAM_ACCOUNT_ELIGIBLE}) AND EXISTS(SELECT 1 FROM sessions WHERE id_hash=? AND person_id=? AND type='member' AND expires_at>?) ON CONFLICT(issuer,subject) DO NOTHING`,
    )
      .bind(
        ulid(),
        personId,
        pending.issuer,
        pending.subject,
        pending.workspace_email,
        now.toISOString(),
        personId,
        sessionHash,
        personId,
        now.toISOString(),
      )
      .run();
    const owner = await this.env.PLATFORM_DB.prepare(
      'SELECT 1 FROM staff_sso_links WHERE issuer=? AND subject=? AND person_id=? AND revoked_at IS NULL',
    )
      .bind(pending.issuer, pending.subject, personId)
      .first();
    if (!owner) return { kind: 'conflict' };
    const session = await createSsoSession(
      this.env,
      {
        issuer: pending.issuer,
        subject: pending.subject,
        email: pending.workspace_email,
        expiresAt: new Date(pending.principal_expires_at),
      },
      now,
    );
    return session
      ? { kind: 'ok', personId, returnTo: pending.return_to, session }
      : { kind: 'conflict' };
  }
  async complete(
    token: string,
    input: { email: string; code: string; now?: Date },
  ): Promise<WorkspaceCompletion> {
    const now = input.now ?? new Date();
    if (!(await this.pending(token, now))) return { kind: 'expired' };
    const proof = await checkCode(this.env, {
      ...input,
      now,
      purpose: 'workspace_link',
      requestId: token,
      workspaceLinkId: await this.tokenHash(token),
    });
    if (proof.kind !== 'ok') return proof;
    const pending = await this.env.PLATFORM_DB.prepare(
      'DELETE FROM staff_sso_pending WHERE token_hash=? AND expires_at>? RETURNING issuer,subject,workspace_email,return_to,principal_expires_at,expires_at',
    )
      .bind(await this.tokenHash(token), now.toISOString())
      .first<Pending>();
    if (!pending) return { kind: 'expired' };
    await this.env.PLATFORM_DB.prepare(
      `INSERT INTO staff_sso_links(id,person_id,issuer,subject,email,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND ${TEAM_ACCOUNT_ELIGIBLE}) ON CONFLICT(issuer,subject) DO NOTHING`,
    )
      .bind(
        ulid(),
        proof.personId,
        pending.issuer,
        pending.subject,
        pending.workspace_email,
        now.toISOString(),
        proof.personId,
      )
      .run();
    const owner = await this.env.PLATFORM_DB.prepare(
      'SELECT 1 FROM staff_sso_links WHERE issuer=? AND subject=? AND person_id=? AND revoked_at IS NULL',
    )
      .bind(pending.issuer, pending.subject, proof.personId)
      .first();
    if (!owner) return { kind: 'conflict' };
    await this.env.PLATFORM_DB.prepare(
      `UPDATE people SET email_verified_at=coalesce(email_verified_at,?),updated_at=? WHERE id=? AND email=? AND deleted_at IS NULL`,
    )
      .bind(now.toISOString(), now.toISOString(), proof.personId, normalizeEmail(input.email))
      .run();
    const session = await createSsoSession(
      this.env,
      {
        issuer: pending.issuer,
        subject: pending.subject,
        email: pending.workspace_email,
        expiresAt: new Date(pending.principal_expires_at),
      },
      now,
    );
    return session
      ? { kind: 'ok', personId: proof.personId, returnTo: pending.return_to, session }
      : { kind: 'conflict' };
  }
}

export { bootstrapSsoStaffAdmin } from './staff-sso-bootstrap';

export async function ssoPrincipalStatus(
  db: Db,
  principal: Pick<SsoPrincipal, 'issuer' | 'subject'>,
): Promise<'linked' | 'unknown' | 'revoked' | 'unavailable'> {
  const link = await db
    .prepare(
      `SELECT l.revoked_at,p.deleted_at,p.membership_status FROM staff_sso_links l LEFT JOIN people p ON p.id=l.person_id WHERE l.issuer=? AND l.subject=?`,
    )
    .bind(principal.issuer, principal.subject)
    .first<{ revoked_at: string | null; deleted_at: string | null; membership_status: string }>();
  if (!link) return 'unknown';
  if (link.revoked_at) return 'revoked';
  return link.deleted_at || link.membership_status === 'former_member' ? 'unavailable' : 'linked';
}
