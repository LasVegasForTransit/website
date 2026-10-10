import type { Db, SqlValue } from './db';
export type MergeRow = Record<string, SqlValue>;
export function rowValue(row: MergeRow, field: string): SqlValue {
  const value = row[field];
  if (value === undefined) throw new Error(`Merge row is missing ${field}`);
  return value;
}
export const RELATED_TABLES = {
  consent_records: {
    key: 'id',
    columns:
      'id,person_id,scope,given_at,source,method,wording_version,withdrawn_at,withdrawn_source,created_at,updated_at',
  },
  consent_withdrawals: {
    key: 'id',
    columns: 'id,person_id,origin_person_id,scope,source,withdrawn_at,recorded_at',
  },
  identities: {
    key: 'id',
    columns:
      'id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at',
  },
  engagement_events: {
    key: 'id',
    columns: 'id,person_id,type,occurred_at,source,reference,details,created_at',
  },
  committee_assignments: {
    key: 'id',
    columns:
      'id,person_id,committee_id,role,started_at,ended_at,end_reason,assigned_by,ended_by,updated_at',
  },
  person_corrections: {
    key: 'id',
    columns: 'id,person_id,actor_id,reason,changes,operation_id,corrected_at',
  },
  form_submissions: { key: 'form_token', columns: 'form_token,person_id,created_at,updated_at' },
  workspace_link_operations: {
    key: 'operation_id',
    columns: 'operation_id,person_id,workspace_subject,created_at',
  },
} as const;
export type RelatedTable = keyof typeof RELATED_TABLES;
const PERSON_FIELDS =
  'id,given_name,family_name,email,email_verified_at,phone,zip,census_block,census_block_vintage,preferred_language,membership_status,membership_rules_version,created_at,updated_at,deleted_at,place_name,region_id,region_source,region_set_at,erased_at';
const OTHER_TABLES = {
  people: { columns: PERSON_FIELDS, order: 'id', filter: 'id IN (?,?)', copies: 1 },
  field_sources: {
    columns: 'person_id,field,source,confirmed_at,created_at,updated_at',
    order: 'person_id,field',
    filter: 'person_id IN (?,?)',
    copies: 1,
  },
  staff_administrators: {
    columns: 'person_id,designated_by,designated_at',
    order: 'person_id',
    filter: 'person_id IN (?,?)',
    copies: 1,
  },
  review_queue: {
    columns:
      'id,candidate_person_id,existing_person_id,reason,created_at,updated_at,resolved_at,resolved_by,resolution,details',
    order: 'id',
    filter: 'candidate_person_id IN (?,?) OR existing_person_id IN (?,?)',
    copies: 2,
  },
  merges: {
    columns:
      'id,surviving_person_id,merged_person_id,merged_at,merged_by,moved_rows,unmerged_at,unmerged_by,created_at,updated_at,operation_id,reason,erased_at',
    order: 'id',
    filter: 'surviving_person_id IN (?,?) OR merged_person_id IN (?,?)',
    copies: 2,
  },
} as const;
export interface MergeSnapshot {
  table: string;
  sql: string;
  values: SqlValue[];
  json: string;
  rows: MergeRow[];
}
function jsonRows(table: string, columns: string, order: string, filter: string): string {
  const pairs = columns
    .split(',')
    .map((column) => `'${column}',${column}`)
    .join(',');
  return `(SELECT json_group_array(json(doc)) FROM (SELECT json_object(${pairs}) AS doc FROM ${table} WHERE ${filter} ORDER BY ${order}))`;
}
export async function captureMergeState(
  db: Db,
  ids: [string, string],
  movements: Movement[] = [],
): Promise<MergeSnapshot[]> {
  const snapshots: MergeSnapshot[] = [];
  const specs = [
    ...Object.entries(RELATED_TABLES).map(([table, spec]) => ({
      table,
      ...spec,
      order: spec.key,
      filter: `person_id IN (?,?) OR ${spec.key} IN (SELECT json_extract(value,'$.key') FROM json_each(?) WHERE json_extract(value,'$.table')='${table}')`,
      copies: 1,
      extra: JSON.stringify(movements),
    })),
    ...Object.entries(OTHER_TABLES).map(([table, spec]) => ({ table, ...spec })),
  ];
  for (const spec of specs) {
    const sql = jsonRows(spec.table, spec.columns, spec.order, spec.filter);
    const values: SqlValue[] = Array.from({ length: spec.copies }, () => ids).flat();
    if ('extra' in spec) values.push(spec.extra);
    const result = await db
      .prepare(`SELECT ${sql} AS json`)
      .bind(...values)
      .first<{ json: string }>();
    const json = result?.json ?? '[]';
    snapshots.push({ table: spec.table, sql, values, json, rows: JSON.parse(json) as MergeRow[] });
  }
  return snapshots;
}
export function stateRows(state: MergeSnapshot[], table: string): MergeRow[] {
  return state.find((snapshot) => snapshot.table === table)?.rows ?? [];
}
export interface Movement {
  table: RelatedTable;
  key: string;
  before: MergeRow;
}
export interface CopiedField {
  field: string;
  before: SqlValue;
  after: SqlValue;
  beforeSource: MergeRow | null;
  afterSource: MergeRow | null;
}
export interface SuppressedConsent {
  id: string;
  before: MergeRow;
  after: MergeRow;
}
export interface MergeBookkeeping {
  rows: Movement[];
  fields: CopiedField[];
  archivedBefore: MergeRow;
  archivedAfter: MergeRow;
  suppressed: SuppressedConsent[];
  copiedAdmin: MergeRow | null;
  reviews: MergeRow[];
  withdrawalIds: string[];
}
export interface MergeRecord {
  id: string;
  surviving_person_id: string;
  merged_person_id: string;
  merged_at: string;
  merged_by: string;
  moved_rows: string;
  unmerged_at: string | null;
  erased_at: string | null;
  operation_id: string;
  reason: string | null;
}
