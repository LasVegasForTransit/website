import type {
  DirectoryAccount,
  WorkspaceDisposition,
} from '@lasvegasfortransit/platform-core/workspace-onboarding';
import type { Db, Statement } from './db';
interface Input {
  account: DirectoryAccount;
  state: WorkspaceDisposition;
  ids: { accountId: string; identityId: string; personId: string };
  create: boolean;
  now: Date;
}
function newPerson(db: Db, input: Input): Statement[] {
  const { account: a, ids, now } = input,
    stamp = now.toISOString();
  const guard = `NOT EXISTS(SELECT 1 FROM identities WHERE platform='google_workspace' AND external_id=?)
    AND NOT EXISTS(SELECT 1 FROM workspace_directory_accounts WHERE customer_id=? AND user_id=? AND (identity_record_id IS NOT NULL OR state='revoked'))`;
  return [
    db
      .prepare(
        `INSERT INTO people(id,given_name,family_name,email,created_at,updated_at)
      SELECT ?,?,?,CASE WHEN EXISTS(SELECT 1 FROM people WHERE email=? AND deleted_at IS NULL) THEN NULL ELSE ? END,?,? WHERE ${guard}`,
      )
      .bind(
        ids.personId,
        a.givenName,
        a.familyName,
        a.email,
        a.email,
        stamp,
        stamp,
        a.userId,
        a.customerId,
        a.userId,
      ),
    db
      .prepare(
        'INSERT INTO staff_team_accounts(person_id,created_at) SELECT id,? FROM people WHERE id=?',
      )
      .bind(stamp, ids.personId),
    db
      .prepare(
        `INSERT INTO identities(id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at)
      SELECT ?,id,'google_workspace',?,? ,?,'created_by_platform',?,? FROM people WHERE id=?`,
      )
      .bind(ids.identityId, a.userId, a.email, stamp, stamp, stamp, ids.personId),
    ...['given_name', 'family_name', 'email'].map((field) =>
      db
        .prepare(
          `INSERT INTO field_sources(person_id,field,source,confirmed_at,created_at,updated_at)
      SELECT id,?,'workspace_directory',?,?,? FROM people WHERE id=?`,
        )
        .bind(field, stamp, stamp, stamp, ids.personId),
    ),
  ];
}
export function enrollmentWrites(db: Db, input: Input): Statement[] {
  const { account: a, state, ids, now } = input,
    stamp = now.toISOString();
  const changed = `workspace_directory_accounts.state IS NOT excluded.state OR workspace_directory_accounts.email IS NOT excluded.email OR workspace_directory_accounts.org_unit_id IS NOT excluded.org_unit_id`;
  return [
    ...(input.create ? newPerson(db, input) : []),
    db
      .prepare(
        `INSERT INTO workspace_directory_accounts(id,customer_id,user_id,identity_record_id,email,org_unit_id,state,provisional,observed_at,created_at,updated_at,console_due_at)
      VALUES(?,?,?,(SELECT id FROM identities WHERE platform='google_workspace' AND external_id=?),?,?,?,?,?,?,?,?)
      ON CONFLICT(customer_id,user_id) DO UPDATE SET identity_record_id=coalesce(workspace_directory_accounts.identity_record_id,excluded.identity_record_id),
      email=excluded.email,org_unit_id=excluded.org_unit_id,state=excluded.state,observed_at=excluded.observed_at,updated_at=excluded.updated_at,
      provisional=CASE WHEN workspace_directory_accounts.identity_record_id IS NULL AND excluded.identity_record_id IS NOT NULL THEN excluded.provisional ELSE workspace_directory_accounts.provisional END,
      console_lease=CASE WHEN ${changed} THEN NULL ELSE workspace_directory_accounts.console_lease END,
      console_lease_until=CASE WHEN ${changed} THEN NULL ELSE workspace_directory_accounts.console_lease_until END,
      revision=workspace_directory_accounts.revision+CASE WHEN ${changed} THEN 1 ELSE 0 END,
      console_due_at=CASE WHEN ${changed} THEN excluded.console_due_at ELSE workspace_directory_accounts.console_due_at END
      WHERE workspace_directory_accounts.observed_at<excluded.observed_at AND workspace_directory_accounts.state<>'revoked'`,
      )
      .bind(
        ids.accountId,
        a.customerId,
        a.userId,
        a.userId,
        a.email,
        a.orgUnitId,
        state,
        Number(input.create),
        a.observedAt,
        stamp,
        stamp,
        stamp,
      ),
    db
      .prepare(
        `INSERT INTO staff_team_accounts(person_id,created_at) SELECT i.person_id,? FROM identities i JOIN workspace_directory_accounts d ON d.identity_record_id=i.id
      JOIN people p ON p.id=i.person_id WHERE d.customer_id=? AND d.user_id=? AND d.state='active' AND p.deleted_at IS NULL
      ON CONFLICT(person_id) DO NOTHING`,
      )
      .bind(stamp, a.customerId, a.userId),
    db
      .prepare(
        `UPDATE identities SET external_email=?,updated_at=? WHERE platform='google_workspace' AND external_id=?
      AND external_email IS NOT ? AND EXISTS(SELECT 1 FROM workspace_directory_accounts d WHERE d.identity_record_id=identities.id AND d.customer_id=? AND d.observed_at=? AND d.state<>'revoked')`,
      )
      .bind(a.email, stamp, a.userId, a.email, a.customerId, a.observedAt),
  ];
}
