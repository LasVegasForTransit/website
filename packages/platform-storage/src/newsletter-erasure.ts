import type { Db, Statement, SqlValue } from './db';
import { newsletterEmailKey } from './newsletter-work';

const SNAPSHOT = `WITH RECURSIVE affected(id) AS (
  SELECT id FROM (__SEEDS__)
  UNION SELECT CASE WHEN m.surviving_person_id=a.id THEN m.merged_person_id ELSE m.surviving_person_id END
  FROM merges m JOIN affected a ON a.id IN (m.surviving_person_id,m.merged_person_id)
  WHERE m.unmerged_at IS NULL AND m.erased_at IS NULL)
  SELECT json_group_array(json_object('kind',kind,'id',id,'personId',person_id,'account',external_id,'email',email)) AS snapshot
  FROM (SELECT 'person' AS kind,id,id AS person_id,NULL AS external_id,email FROM people WHERE id IN (SELECT id FROM affected)
    UNION ALL SELECT 'identity',id,person_id,external_id,external_email FROM identities
      WHERE platform='beehiiv' AND person_id IN (SELECT id FROM affected)
    ORDER BY kind,id)`;
const PEOPLE = '(SELECT person_id FROM person_erasure_scope WHERE operation_id=?)';
const RELATED = `email_key IN (SELECT value FROM json_each((SELECT email_keys FROM newsletter_erasure_checks WHERE operation_id=?)))
  OR subscription_id IN (SELECT external_id FROM identities WHERE platform='beehiiv' AND person_id IN ${PEOPLE})
  OR EXISTS(SELECT 1 FROM newsletter_source_operations o WHERE o.publication_id=newsletter_inbound_events.publication_id
    AND o.event_id=newsletter_inbound_events.id AND o.person_id IN ${PEOPLE})`;

/** Capture addresses before erasure and verify that exact ownership inside its transaction. */
export async function newsletterErasureWrites(
  db: Db,
  selection: string | { sql: string; values: SqlValue[] },
  operationId: string,
  stamp: string,
): Promise<Statement[]> {
  // Historical upgrade fixtures predate the inbox. An installed inbox requires
  // the erasure migration; missing current tables fail rather than skip cleanup.
  if (
    !(await db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='newsletter_inbound_events'")
      .first())
  )
    return [];
  const seeds =
    typeof selection === 'string'
      ? { sql: 'SELECT id FROM people WHERE id=? AND erased_at IS NULL', values: [selection] }
      : selection;
  const snapshotQuery = SNAPSHOT.replace('__SEEDS__', seeds.sql);
  const row = await db
    .prepare(snapshotQuery)
    .bind(...seeds.values)
    .first<{ snapshot: string }>();
  if (!row) throw new Error('Newsletter erasure could not read current ownership');
  const addresses = JSON.parse(row.snapshot) as { email: string | null }[];
  const keys = await Promise.all(
    [...new Set(addresses.flatMap((value) => (value.email ? [value.email] : [])))].map(
      newsletterEmailKey,
    ),
  );
  return [
    db
      .prepare(
        `INSERT INTO newsletter_erasure_checks(operation_id,valid_snapshot,email_keys) VALUES(?,((${snapshotQuery})=?),?)`,
      )
      .bind(operationId, ...seeds.values, row.snapshot, JSON.stringify(keys)),
    db
      .prepare(
        `UPDATE newsletter_erasure_checks SET email_keys=(SELECT json_group_array(account_key) FROM (
          SELECT value AS account_key FROM json_each(newsletter_erasure_checks.email_keys)
          UNION SELECT account_key FROM newsletter_write_intents WHERE person_id IN ${PEOPLE}
          UNION SELECT account_key FROM newsletter_write_attempts WHERE person_id IN ${PEOPLE}
          UNION SELECT activation_email_key FROM newsletter_sync_jobs WHERE person_id IN ${PEOPLE})
        WHERE account_key LIKE 'email:%') WHERE operation_id=?`,
      )
      .bind(operationId, operationId, operationId, operationId),
    db
      .prepare(
        `INSERT INTO newsletter_address_tombstones(email_key,erased_at)
        SELECT value,? FROM json_each((SELECT email_keys FROM newsletter_erasure_checks WHERE operation_id=?)) WHERE true
        ON CONFLICT(email_key) DO UPDATE SET erased_at=max(erased_at,excluded.erased_at)`,
      )
      .bind(stamp, operationId),
    db
      .prepare(
        `INSERT INTO newsletter_address_tombstones(email_key,erased_at)
        SELECT email_key,? FROM newsletter_inbound_events WHERE ${RELATED}
        ON CONFLICT(email_key) DO UPDATE SET erased_at=max(erased_at,excluded.erased_at)`,
      )
      .bind(stamp, operationId, operationId, operationId),
    db
      .prepare(
        `UPDATE newsletter_inbound_events SET encrypted_email=NULL,
        state=CASE WHEN state IN ('pending','needs_review') THEN 'ignored' ELSE state END WHERE ${RELATED}`,
      )
      .bind(operationId, operationId, operationId),
    db
      .prepare(
        `UPDATE newsletter_source_operations SET outcome='ignored',reason='account_removed'
        WHERE outcome='needs_review' AND EXISTS(SELECT 1 FROM newsletter_inbound_events
          WHERE publication_id=newsletter_source_operations.publication_id AND id=newsletter_source_operations.event_id
          AND state='ignored' AND encrypted_email IS NULL AND (${RELATED}))`,
      )
      .bind(operationId, operationId, operationId),
    db.prepare('DELETE FROM newsletter_erasure_checks WHERE operation_id=?').bind(operationId),
  ];
}
