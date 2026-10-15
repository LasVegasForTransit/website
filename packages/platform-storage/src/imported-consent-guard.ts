import type { SqlValue } from './db';
import { normalizeEmail } from './field-ownership';
import type { ImportedNewsletterEvidence } from './imported-consent';

/** Recheck identity, review and later choices inside the same transaction as the write. */
export function importedConsentGuard(
  personId: string,
  identityId: string,
  input: ImportedNewsletterEvidence,
): { sql: string; values: SqlValue[] } {
  return {
    sql: `EXISTS(SELECT 1 FROM people p JOIN identities i ON i.person_id=p.id
      WHERE p.id=? AND p.deleted_at IS NULL AND p.erased_at IS NULL AND i.id=? AND i.platform=? AND i.external_id=? AND lower(trim(i.external_email))=?)
      AND NOT EXISTS(SELECT 1 FROM review_queue WHERE (candidate_person_id=? OR existing_person_id=?) AND resolved_at IS NULL)
      AND (? IS NOT NULL OR (NOT EXISTS(SELECT 1 FROM consent_withdrawals
        WHERE (person_id=? OR origin_person_id=?) AND scope='newsletter'
        AND (julianday(withdrawn_at) IS NULL OR julianday(withdrawn_at)>=julianday(?)))
      AND NOT EXISTS(SELECT 1 FROM consent_records WHERE person_id=? AND scope='newsletter' AND withdrawn_at IS NOT NULL
        AND (julianday(withdrawn_at) IS NULL OR julianday(withdrawn_at)>=julianday(?)))))`,
    values: [
      personId,
      identityId,
      input.platform,
      input.externalId,
      normalizeEmail(input.email),
      personId,
      personId,
      input.withdrawnAt,
      personId,
      personId,
      input.givenAt,
      personId,
      input.givenAt,
    ],
  };
}
export function importedConsentChanged(result: unknown): boolean {
  if (typeof result !== 'object' || result === null || !('meta' in result)) return false;
  const meta = result.meta;
  return (
    typeof meta === 'object' &&
    meta !== null &&
    'changes' in meta &&
    typeof meta.changes === 'number' &&
    meta.changes > 0
  );
}
