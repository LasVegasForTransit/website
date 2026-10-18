import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { can } from '@lasvegasfortransit/platform-core/permissions';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, Statement } from './db';
import { auditDenied } from './audits';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { COUNTED_ENGAGEMENT } from './engagement';
export type ExportRow = Record<string, string | number | null>;
export const EXPORT_COLUMNS = {
  people:
    'id,given_name,family_name,email,email_verified_at,phone,zip,census_block,census_block_vintage,place_name,preferred_language,membership_status,membership_rules_version,region_id,region_source,region_set_at,member_since,created_at,updated_at',
  consent_records:
    'id,person_id,scope,given_at,source,method,wording_version,withdrawn_at,withdrawn_source,withdrawn_time_basis,created_at,updated_at,origin_identity_id,import_run_id',
  identities:
    'id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at',
  engagement_events: 'id,person_id,type,occurred_at,source,reference,details,created_at',
} as const;
export type ExportTable = keyof typeof EXPORT_COLUMNS;
const MEMBER_SINCE_SQL = `(SELECT min(e.occurred_at) FROM engagement_events e
  WHERE e.person_id=p.id AND e.type='subscribed' AND ${COUNTED_ENGAGEMENT}
    AND e.occurred_at > coalesce((SELECT max(e.occurred_at) FROM engagement_events e
      WHERE e.person_id=p.id AND e.type='unsubscribed' AND ${COUNTED_ENGAGEMENT}), ''))`;
export interface FullExport {
  formatVersion: 2;
  exportedAt: string;
  people: ExportRow[];
  consent_records: ExportRow[];
  identities: ExportRow[];
  engagement_events: ExportRow[];
  field_sources: ExportRow[];
  committee_assignments: ExportRow[];
  organization_roles: ExportRow[];
  person_organization_roles: ExportRow[];
  consent_withdrawals: ExportRow[];
  person_corrections: ExportRow[];
  discord_identity_profiles: ExportRow[];
  discord_profiles: ExportRow[];
  roster_import_records: ExportRow[];
  membership_roll: ExportRow[];
  unassigned_roster_import_records: ExportRow[];
}
function profileQueries(db: Db, actorId: string): Statement[] {
  return ['discord_identity_profiles', 'discord_profiles'].map((table) =>
    db
      .prepare(
        `SELECT r.* FROM ${table} r JOIN identities i ON i.id=r.identity_record_id JOIN people p ON p.id=i.person_id WHERE p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE} ORDER BY r.identity_record_id`,
      )
      .bind(actorId),
  );
}
function roleArchiveQueries(db: Db, actorId: string): Statement[] {
  return [
    db
      .prepare(`SELECT * FROM organization_roles WHERE ${STAFF_ADMIN_SCOPE} ORDER BY id`)
      .bind(actorId),
    db
      .prepare(
        `SELECT r.* FROM person_organization_roles r JOIN people p ON p.id=r.person_id WHERE p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE} ORDER BY r.id`,
      )
      .bind(actorId),
  ];
}
function rows(result: unknown): ExportRow[] {
  if (
    !result ||
    typeof result !== 'object' ||
    !('results' in result) ||
    !Array.isArray(result.results)
  )
    throw new Error('The export snapshot could not be read.');
  return result.results as ExportRow[];
}
export async function collectFullExport(
  db: Db,
  actor: Actor,
  now: Date,
): Promise<FullExport | null> {
  const allowed =
    can(actor, 'export.full') &&
    (await db
      .prepare(`SELECT 1 AS allowed WHERE ${STAFF_ADMIN_SCOPE}`)
      .bind(actor.personId)
      .first());
  if (!allowed) {
    await auditDenied(db, actor.personId, 'export.full');
    return null;
  }
  const exportedAt = now.toISOString();
  const tables = Object.entries(EXPORT_COLUMNS).map(([table, columns]) =>
    db
      .prepare(
        table === 'people'
          ? `SELECT ${columns
              .split(',')
              .map((column) =>
                column === 'member_since' ? `${MEMBER_SINCE_SQL} AS member_since` : `p.${column}`,
              )
              .join(',')}
              FROM people p WHERE p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE} ORDER BY p.id`
          : `SELECT ${columns
              .split(',')
              .map((column) => `r.${column}`)
              .join(
                ',',
              )} FROM ${table} r JOIN people p ON p.id=r.person_id WHERE p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE} ORDER BY r.id`,
      )
      .bind(actor.personId),
  );
  const extras = [
    'field_sources',
    'committee_assignments',
    'consent_withdrawals',
    'person_corrections',
  ].map((table) =>
    db
      .prepare(
        `SELECT r.* FROM ${table} r JOIN people p ON p.id=r.person_id WHERE p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE} ORDER BY r.person_id`,
      )
      .bind(actor.personId),
  );
  const result = await db.batch([
    ...tables,
    ...extras,
    ...profileQueries(db, actor.personId),
    db
      .prepare(
        `SELECT r.* FROM membership_roll r JOIN people p ON p.id=r.person_id WHERE p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE} ORDER BY r.external_id`,
      )
      .bind(actor.personId),
    db
      .prepare(
        `SELECT * FROM roster_import_records WHERE person_id IS NULL AND evidence IS NOT NULL AND ${STAFF_ADMIN_SCOPE} ORDER BY id`,
      )
      .bind(actor.personId),
    db
      .prepare(
        `SELECT r.* FROM roster_import_records r JOIN people p ON p.id=r.person_id WHERE p.deleted_at IS NULL AND ${STAFF_ADMIN_SCOPE} ORDER BY r.id`,
      )
      .bind(actor.personId),
    ...roleArchiveQueries(db, actor.personId),
    exportAudit(db, actor, exportedAt),
  ]);
  if (
    !(await db
      .prepare(`SELECT 1 AS allowed WHERE ${STAFF_ADMIN_SCOPE}`)
      .bind(actor.personId)
      .first())
  )
    return null;
  return exportRows(result, exportedAt);
}

function exportAudit(db: Db, actor: Actor, exportedAt: string): Statement {
  return db
    .prepare(
      `INSERT INTO staff_audits(id,actor_id,action,permission,details,occurred_at) SELECT ?,?,'people.export','export.full',json_object('people',(SELECT count(*) FROM people WHERE deleted_at IS NULL),'formatVersion',2),? WHERE ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(ulid(), actor.personId, exportedAt, actor.personId);
}

function exportRows(result: unknown[], exportedAt: string): FullExport {
  return {
    formatVersion: 2,
    exportedAt,
    people: rows(result[0]),
    consent_records: rows(result[1]),
    identities: rows(result[2]),
    engagement_events: rows(result[3]),
    field_sources: rows(result[4]),
    committee_assignments: rows(result[5]),
    consent_withdrawals: rows(result[6]),
    person_corrections: rows(result[7]),
    discord_identity_profiles: rows(result[8]),
    discord_profiles: rows(result[9]),
    membership_roll: rows(result[10]),
    roster_import_records: rows(result[12]),
    unassigned_roster_import_records: rows(result[11]),
    organization_roles: rows(result[13]),
    person_organization_roles: rows(result[14]),
  };
}
