import type { Db, Statement, SqlValue } from './db';
import type { GoogleSnapshot } from './google-group-snapshot-input';

export const GOOGLE_GROUP_REGISTERED = `EXISTS(SELECT 1 FROM (
  SELECT workspace_group_email AS email FROM committees WHERE workspace_group_email IS NOT NULL
  UNION SELECT external_id FROM committee_account_mappings WHERE provider='google_workspace'
  UNION SELECT ? WHERE ? IS NOT NULL) WHERE email=?)`;
export function registeredValues(groupEmail: string, consoleGroupEmail: string | null): SqlValue[] {
  return [consoleGroupEmail, consoleGroupEmail, groupEmail];
}
export function publicationGuard(input: GoogleSnapshot, consoleGroupEmail: string | null) {
  return {
    sql: `EXISTS(SELECT 1 FROM google_group_inventory WHERE context_id=? AND group_email=?
      AND group_id=? AND started_at=? AND observed_at=? AND content_hash=?) AND ${GOOGLE_GROUP_REGISTERED}`,
    values: [
      input.customerId,
      input.groupEmail,
      input.groupId,
      input.startedAt,
      input.observedAt,
      input.hash,
      ...registeredValues(input.groupEmail, consoleGroupEmail),
    ] satisfies SqlValue[],
  };
}
function metadata(db: Db, input: GoogleSnapshot, consoleGroupEmail: string | null): Statement {
  return db
    .prepare(
      `INSERT INTO google_group_inventory(context_id,group_email,group_id,content_hash,started_at,observed_at,expires_at,member_count,user_count)
    SELECT ?,?,?,?,?,?,?,?,? WHERE ${GOOGLE_GROUP_REGISTERED}
    ON CONFLICT(context_id,group_email) DO UPDATE SET group_id=excluded.group_id,content_hash=excluded.content_hash,
      started_at=excluded.started_at,observed_at=excluded.observed_at,expires_at=excluded.expires_at,
      member_count=excluded.member_count,user_count=excluded.user_count
    WHERE excluded.started_at>google_group_inventory.started_at OR
      (excluded.started_at=google_group_inventory.started_at AND excluded.observed_at=google_group_inventory.observed_at
       AND excluded.group_id=google_group_inventory.group_id AND excluded.content_hash=google_group_inventory.content_hash)`,
    )
    .bind(
      input.customerId,
      input.groupEmail,
      input.groupId,
      input.hash,
      input.startedAt,
      input.observedAt,
      input.expiresAt,
      input.members.length,
      input.userCount,
      ...registeredValues(input.groupEmail, consoleGroupEmail),
    );
}
export function googleSnapshotWrites(
  db: Db,
  input: GoogleSnapshot,
  consoleGroupEmail: string | null,
): Statement[] {
  const guard = publicationGuard(input, consoleGroupEmail);
  const writes = [
    metadata(db, input, consoleGroupEmail),
    db
      .prepare(
        `DELETE FROM google_group_inventory_members WHERE context_id=? AND group_email=? AND ${guard.sql}`,
      )
      .bind(input.customerId, input.groupEmail, ...guard.values),
  ];
  for (let offset = 0; offset < input.members.length; offset += 500)
    writes.push(
      db
        .prepare(
          `INSERT INTO google_group_inventory_members(context_id,group_email,member_id,member_type,member_role)
      SELECT ?,?,json_extract(value,'$.id'),json_extract(value,'$.type'),json_extract(value,'$.role') FROM json_each(?) WHERE ${guard.sql}`,
        )
        .bind(
          input.customerId,
          input.groupEmail,
          JSON.stringify(input.members.slice(offset, offset + 500)),
          ...guard.values,
        ),
    );
  writes.push(
    db
      .prepare(
        `DELETE FROM google_group_check_failures WHERE context_id=? AND group_email=? AND started_at<=? AND ${guard.sql}`,
      )
      .bind(input.customerId, input.groupEmail, input.startedAt, ...guard.values),
  );
  return writes;
}
