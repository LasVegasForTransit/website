import { ulid } from '@lasvegasfortransit/platform-core/ids';
import {
  directoryAccount,
  workspacePolicy,
  workspaceDisposition,
  type DirectoryAccount,
  type WorkspacePolicy,
} from '@lasvegasfortransit/platform-core/workspace-onboarding';
import type { Db } from './db';
import { enrollmentWrites } from './workspace-enrollment-writes';
export interface WorkspaceEnrollment {
  id: string;
  customer_id: string;
  user_id: string;
  identity_record_id: string | null;
  person_id: string | null;
  email: string | null;
  org_unit_id: string | null;
  state: string;
  provisional: number;
  revision: number;
  observed_at: string;
  console_state: string;
  console_checked_at: string | null;
  console_failure: string | null;
}
export async function workspaceEnrollment(db: Db, personId: string) {
  return db
    .prepare('SELECT * FROM workspace_enrollments WHERE person_id=?')
    .bind(personId)
    .first<WorkspaceEnrollment>();
}
export async function enrollWorkspaceAccount(
  db: Db,
  input: DirectoryAccount,
  policy: WorkspacePolicy,
  now = new Date(),
): Promise<{ kind: string; personId?: string; changed?: boolean }> {
  const account = directoryAccount(input, now),
    rules = workspacePolicy(policy);
  if (!account || !rules) return { kind: 'invalid' };
  if (outOfScope(account, rules)) return { kind: 'excluded' };
  const existing = await db
    .prepare('SELECT * FROM workspace_enrollments WHERE customer_id=? AND user_id=?')
    .bind(account.customerId, account.userId)
    .first<WorkspaceEnrollment>();
  if (existing?.state === 'revoked') return { kind: 'blocked' };
  if (existing && existing.observed_at >= account.observedAt)
    return { kind: 'stale', ...(existing.person_id ? { personId: existing.person_id } : {}) };
  return enrollCurrent(db, { account, rules, existing }, now);
}
async function enrollCurrent(
  db: Db,
  input: {
    account: DirectoryAccount;
    rules: WorkspacePolicy;
    existing: WorkspaceEnrollment | null;
  },
  now: Date,
) {
  const { account, rules, existing } = input;
  const identity = await matchingIdentity(db, account.userId);
  if (identity?.deleted_at || identity?.erased_at) return { kind: 'blocked' };
  const state = workspaceDisposition(account, rules, Boolean(existing ?? identity));
  if (state === 'excluded' && !existing && !identity) return { kind: 'excluded' };
  const ids = enrollmentIds(existing, identity);
  await db.batch(
    enrollmentWrites(db, { account, state, ids, create: state === 'active' && !identity, now }),
  );
  const saved = await db
    .prepare('SELECT * FROM workspace_enrollments WHERE customer_id=? AND user_id=?')
    .bind(account.customerId, account.userId)
    .first<WorkspaceEnrollment>();
  return savedResult(existing, saved);
}
function savedResult(existing: WorkspaceEnrollment | null, saved: WorkspaceEnrollment | null) {
  if (!saved) return { kind: 'blocked' };
  return {
    kind: saved.state === 'active' ? 'enrolled' : saved.state,
    changed:
      existing?.state !== saved.state ||
      existing.email !== saved.email ||
      existing.org_unit_id !== saved.org_unit_id,
    ...(saved.person_id ? { personId: saved.person_id } : {}),
  };
}

async function matchingIdentity(db: Db, userId: string) {
  return db
    .prepare(
      `SELECT i.id,i.person_id,p.deleted_at,k.erased_at FROM identities i
    JOIN person_keys k ON k.id=i.person_id LEFT JOIN people p ON p.id=i.person_id
    WHERE i.platform='google_workspace' AND i.external_id=?`,
    )
    .bind(userId)
    .first<{
      id: string;
      person_id: string;
      deleted_at: string | null;
      erased_at: string | null;
    }>();
}

function outOfScope(account: DirectoryAccount, rules: WorkspacePolicy) {
  return (
    account.customerId !== rules.customerId ||
    (rules.environment === 'preview' && !rules.previewUserIds.includes(account.userId))
  );
}

function enrollmentIds(
  existing: WorkspaceEnrollment | null,
  identity: Awaited<ReturnType<typeof matchingIdentity>>,
) {
  return {
    accountId: existing?.id ?? ulid(),
    identityId: identity?.id ?? ulid(),
    personId: identity?.person_id ?? ulid(),
  };
}
