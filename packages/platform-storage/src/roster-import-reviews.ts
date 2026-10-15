import type { Db } from './db';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import { PermissionDenied, can } from '@lasvegasfortransit/platform-core/permissions';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditDenied } from './audits';
export interface RosterReviewRow {
  id: string;
  personId: string | null;
  suggestedPersonId: string | null;
  suggestedName: string | null;
  suggestedEmail: string | null;
  suggestedUpdatedAt: string | null;
  sourceId: string;
  evidenceHash: string;
  email: string | null;
  name: string;
  source: string;
  reasons: string;
  recordedAt: string;
  evidence: string;
}
/** Only current administrators can read imported personal evidence. */
export async function rosterImportReviews(
  db: Db,
  actor: Actor,
  after = '',
): Promise<{ items: RosterReviewRow[]; next: string | null }> {
  if (
    !can(actor, 'export.full') ||
    !(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first())
  ) {
    await auditDenied(db, actor.personId, 'export.full');
    throw new PermissionDenied('export.full');
  }
  const rows = (
    await db
      .prepare(
        `SELECT r.id,r.person_id AS personId,r.suggested_person_id AS suggestedPersonId,
    r.source_id AS sourceId,r.evidence_hash AS evidenceHash,json_extract(r.evidence,'$.email') AS email,
    coalesce(nullif(trim(coalesce(s.given_name,'')||' '||coalesce(s.family_name,'')),''),s.email) AS suggestedName,s.email AS suggestedEmail,s.updated_at AS suggestedUpdatedAt,
    coalesce(nullif(trim(coalesce(p.given_name,'')||' '||coalesce(p.family_name,'')),''),nullif(json_extract(r.evidence,'$.form.fullName'),''),p.email,json_extract(r.evidence,'$.email'),'Name not recorded') AS name,
    r.source,r.reasons,r.recorded_at AS recordedAt,r.evidence FROM roster_import_records r LEFT JOIN people p ON p.id=r.person_id LEFT JOIN people s ON s.id=r.suggested_person_id AND s.deleted_at IS NULL
    WHERE r.state='held' AND r.evidence IS NOT NULL AND (r.person_id IS NULL OR p.deleted_at IS NULL)
      AND r.id>? AND ${STAFF_ADMIN_SCOPE} ORDER BY r.id LIMIT 51`,
      )
      .bind(after, actor.personId)
      .all<RosterReviewRow>()
  ).results;
  return { items: rows.slice(0, 50), next: rows.length > 50 ? (rows[49]?.id ?? null) : null };
}
