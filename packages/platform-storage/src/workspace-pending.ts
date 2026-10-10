import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import type { WorkspaceIdentity } from '@lasvegasfortransit/platform-core/workspace-identity';
import {
  checkCode,
  requestCode,
  type AuthEnv,
  type CheckOutcome,
  type RequestOutcome,
} from './auth';
import { normalizeEmail } from './person-service';
import { approvedDestinations } from './workspace-state';
import { linkWorkspaceIdentity } from './workspace-identity-link';
import { createWorkspaceSession } from './workspace-session';
export interface PendingLinkRow {
  workspace_subject: string;
  workspace_email: string;
  given_name: string | null;
  family_name: string | null;
  return_to: string;
}

export type WorkspaceCompletion =
  | { kind: 'ok'; personId: string; returnTo: string; session: { token: string; expiresAt: Date } }
  | { kind: 'conflict' | 'expired' }
  | Extract<CheckOutcome, { kind: 'wrong' | 'too_many' }>;

export class WorkspaceLinkService {
  constructor(private readonly env: AuthEnv) {}

  private tokenHash(token: string) {
    return hashWithSecret(this.env.LVBT_SIGN_IN_SECRET, `workspace-link:${token}`);
  }

  async begin(
    workspace: WorkspaceIdentity,
    input: { returnTo: string; now?: Date },
  ): Promise<string> {
    approvedDestinations(input.returnTo, 'https://lasvegasfortransit.org/sign-in/google/callback');
    const token = randomToken();
    const now = input.now ?? new Date();
    await this.env.PLATFORM_DB.prepare(
      `INSERT INTO workspace_pending_links (token_hash, workspace_subject, workspace_email, given_name, family_name, return_to, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        await this.tokenHash(token),
        workspace.subject,
        workspace.email,
        workspace.givenName,
        workspace.familyName,
        input.returnTo,
        new Date(now.getTime() + 15 * 60_000).toISOString(),
        now.toISOString(),
      )
      .run();
    return token;
  }

  async pending(token: string, now: Date = new Date()) {
    if (!/^[\w-]{43}$/.test(token)) return null;
    return await this.env.PLATFORM_DB.prepare(
      'SELECT workspace_subject, workspace_email, given_name, family_name, return_to FROM workspace_pending_links WHERE token_hash = ? AND expires_at > ?',
    )
      .bind(await this.tokenHash(token), now.toISOString())
      .first<PendingLinkRow>();
  }

  async requestCode(
    token: string,
    input: { email: string; callerAddress: string; now?: Date },
  ): Promise<RequestOutcome | { kind: 'expired' }> {
    const now = input.now ?? new Date();
    if (!(await this.pending(token, now))) return { kind: 'expired' };
    return await requestCode(this.env, {
      ...input,
      now,
      purpose: 'workspace_link',
      workspaceLinkId: await this.tokenHash(token),
    });
  }

  private async consume(token: string, now: Date) {
    return await this.env.PLATFORM_DB.prepare(
      `DELETE FROM workspace_pending_links WHERE token_hash = ? AND expires_at > ?
       RETURNING workspace_subject, workspace_email, given_name, family_name, return_to`,
    )
      .bind(await this.tokenHash(token), now.toISOString())
      .first<PendingLinkRow>();
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
    const pending = await this.consume(token, now);
    if (!pending) return { kind: 'expired' };
    const outcome = await this.finishLink(pending, proof.personId, 'self_linked', now);
    if (outcome.kind === 'ok')
      await this.env.PLATFORM_DB.prepare(
        'UPDATE people SET email_verified_at = coalesce(email_verified_at, ?), updated_at = ? WHERE id = ? AND email = ?',
      )
        .bind(now.toISOString(), now.toISOString(), proof.personId, normalizeEmail(input.email))
        .run();
    return outcome;
  }

  private workspace(pending: PendingLinkRow): WorkspaceIdentity {
    return {
      subject: pending.workspace_subject,
      email: pending.workspace_email,
      givenName: pending.given_name,
      familyName: pending.family_name,
    };
  }

  private async finishLink(
    pending: PendingLinkRow,
    personId: string,
    method: 'self_linked',
    now: Date,
  ): Promise<WorkspaceCompletion> {
    const workspace = this.workspace(pending);
    const linked = await linkWorkspaceIdentity(this.env.PLATFORM_DB, {
      workspace,
      personId,
      method,
      operationId: ulid(),
    });
    if (linked.kind !== 'ok') return { kind: 'conflict' };
    const session = await createWorkspaceSession(this.env, workspace, now);
    return session
      ? { kind: 'ok', personId, returnTo: pending.return_to, session }
      : { kind: 'conflict' };
  }
}
