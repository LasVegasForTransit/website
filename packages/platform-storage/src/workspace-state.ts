import { digestToken, randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { WorkspaceIdentity } from '@lasvegasfortransit/platform-core/workspace-identity';
import type { Db } from './db';
import type { PendingLinkRow } from './workspace-pending';
const STATE_MINUTES = 10;
const CALLBACK_HOSTS = new Set([
  'lasvegasfortransit.org',
  'staff.lasvegasfortransit.org',
  'preview.lasvegasfortransit.org',
  'staff-preview.lasvegasfortransit.org',
]);

export interface WorkspaceState {
  verifier: string;
  nonce: string;
  returnTo: string;
  callbackUrl: string;
  origin: string;
}

export function approvedDestinations(returnTo: string, callbackUrl: string): void {
  const callback = new URL(callbackUrl);
  if (
    !returnTo.startsWith('/') ||
    returnTo.startsWith('//') ||
    /[\\\r\n]/.test(returnTo) ||
    callback.protocol !== 'https:' ||
    !CALLBACK_HOSTS.has(callback.hostname) ||
    callback.port ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash ||
    callback.pathname !== '/sign-in/google/callback'
  )
    throw new Error('Workspace sign-in destination is not allowed');
}

export async function beginWorkspaceSignIn(
  db: Db,
  input: { returnTo: string; callbackUrl: string; origin?: string; now?: Date },
): Promise<WorkspaceState & { state: string; challenge: string }> {
  approvedDestinations(input.returnTo, input.callbackUrl);
  const now = input.now ?? new Date();
  const state = randomToken();
  const verifier = randomToken();
  const nonce = randomToken();
  await db
    .prepare(
      `INSERT INTO workspace_oauth_states
     (state_hash, verifier, nonce, return_to, callback_url, origin_url, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      await digestToken(state),
      verifier,
      nonce,
      input.returnTo,
      input.callbackUrl,
      input.origin ?? new URL(input.callbackUrl).origin,
      new Date(now.getTime() + STATE_MINUTES * 60_000).toISOString(),
      now.toISOString(),
    )
    .run();
  return {
    state,
    verifier,
    challenge: await digestToken(verifier),
    nonce,
    returnTo: input.returnTo,
    callbackUrl: input.callbackUrl,
    origin: input.origin ?? new URL(input.callbackUrl).origin,
  };
}

export async function consumeWorkspaceState(
  db: Db,
  state: string,
  now: Date = new Date(),
): Promise<WorkspaceState | null> {
  if (!/^[\w-]{43}$/.test(state)) return null;
  const row = await db
    .prepare(
      `DELETE FROM workspace_oauth_states WHERE state_hash = ? AND expires_at > ?
     RETURNING verifier, nonce, return_to, callback_url, origin_url`,
    )
    .bind(await digestToken(state), now.toISOString())
    .first<{
      verifier: string;
      nonce: string;
      return_to: string;
      callback_url: string;
      origin_url: string;
    }>();
  return row
    ? {
        verifier: row.verifier,
        nonce: row.nonce,
        returnTo: row.return_to,
        callbackUrl: row.callback_url,
        origin: row.origin_url,
      }
    : null;
}

export async function issueWorkspaceTicket(
  db: Db,
  input: {
    workspace: WorkspaceIdentity;
    state: string;
    origin: string;
    returnTo: string;
    now?: Date;
  },
) {
  const ticket = randomToken();
  const now = input.now ?? new Date();
  await db
    .prepare(
      `INSERT INTO workspace_callback_tickets (ticket_hash, state_hash, origin_url, return_to, workspace_subject, workspace_email, given_name, family_name, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      await digestToken(ticket),
      await digestToken(input.state),
      input.origin,
      input.returnTo,
      input.workspace.subject,
      input.workspace.email,
      input.workspace.givenName,
      input.workspace.familyName,
      new Date(now.getTime() + 60_000).toISOString(),
    )
    .run();
  return ticket;
}

export async function consumeWorkspaceTicket(
  db: Db,
  input: { ticket: string; state: string; origin: string; now?: Date },
) {
  if (!/^[\w-]{43}$/.test(input.ticket) || !/^[\w-]{43}$/.test(input.state)) return null;
  const row = await db
    .prepare(
      `DELETE FROM workspace_callback_tickets WHERE ticket_hash = ? AND state_hash = ? AND origin_url = ? AND expires_at > ?
     RETURNING workspace_subject, workspace_email, given_name, family_name, return_to`,
    )
    .bind(
      await digestToken(input.ticket),
      await digestToken(input.state),
      input.origin,
      (input.now ?? new Date()).toISOString(),
    )
    .first<PendingLinkRow>();
  return row
    ? {
        workspace: {
          subject: row.workspace_subject,
          email: row.workspace_email,
          givenName: row.given_name,
          familyName: row.family_name,
        },
        returnTo: row.return_to,
      }
    : null;
}
