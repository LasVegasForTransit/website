import type { Db, Statement, SqlValue } from './db';
import type { GoogleSnapshot } from './google-group-snapshot-input';
import { googleExpectedAccess } from './google-group-query';

/** These dates describe direct group membership differences, not inherited access. */
export function googleGroupMismatchWrites(
  db: Db,
  input: GoogleSnapshot,
  consoleGroupEmail: string | null,
  guard: { sql: string; values: SqlValue[] },
): Statement[] {
  if (input.userCount === null) return [];
  const differences = `WITH settings AS (SELECT ? AS console_group,? AS group_email), linked AS (
 SELECT p.id AS person_id,i.external_id AS identity_id,${googleExpectedAccess('p', '(SELECT group_email FROM settings)')} AS expected,
 EXISTS(SELECT 1 FROM google_group_inventory_members m WHERE m.context_id=? AND m.group_email=? AND m.member_type='USER' AND m.member_id=i.external_id) AS held
 FROM people p JOIN identities i ON i.person_id=p.id WHERE p.deleted_at IS NULL AND i.platform='google_workspace'
 AND i.link_method IN ('self_linked','staff_confirmed') AND (SELECT count(*) FROM identities other WHERE other.person_id=p.id AND other.platform='google_workspace')=1
 ), differences AS (SELECT * FROM linked WHERE expected<>held)`;
  const values = [consoleGroupEmail, input.groupEmail, input.customerId, input.groupEmail];
  return [
    db
      .prepare(
        `${differences} INSERT INTO access_mismatch_observations(provider,context_id,resource_id,identity_id,person_id,expected_access,first_seen_at,last_seen_at)
 SELECT 'google_workspace',?,?,identity_id,person_id,expected,?,? FROM differences WHERE ${guard.sql}
 ON CONFLICT(provider,context_id,resource_id,identity_id) DO UPDATE SET person_id=excluded.person_id,expected_access=excluded.expected_access,
 first_seen_at=CASE WHEN access_mismatch_observations.person_id=excluded.person_id AND access_mismatch_observations.expected_access=excluded.expected_access
 THEN access_mismatch_observations.first_seen_at ELSE excluded.first_seen_at END,last_seen_at=excluded.last_seen_at
 WHERE excluded.last_seen_at>=access_mismatch_observations.last_seen_at`,
      )
      .bind(
        ...values,
        input.customerId,
        input.groupEmail,
        input.observedAt,
        input.observedAt,
        ...guard.values,
      ),
    db
      .prepare(
        `${differences} DELETE FROM access_mismatch_observations WHERE provider='google_workspace' AND context_id=? AND resource_id=? AND ${guard.sql}
 AND NOT EXISTS(SELECT 1 FROM differences d WHERE d.identity_id=access_mismatch_observations.identity_id AND d.person_id=access_mismatch_observations.person_id AND d.expected=access_mismatch_observations.expected_access)`,
      )
      .bind(...values, input.customerId, input.groupEmail, ...guard.values),
  ];
}
