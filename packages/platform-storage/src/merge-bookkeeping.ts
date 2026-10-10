import type { SqlValue } from './db';
import {
  RELATED_TABLES,
  rowValue,
  stateRows,
  type CopiedField,
  type MergeBookkeeping,
  type MergeRow,
  type MergeSnapshot,
  type SuppressedConsent,
} from './merge-state';
export interface Withdrawal {
  scope: string;
  date: string;
  source: string;
  recordedAt: string;
}
export function latestWithdrawals(state: MergeSnapshot[]): Withdrawal[] {
  const evidence = [
    ...stateRows(state, 'consent_records')
      .filter((row) => row.withdrawn_at !== null)
      .map((row) => ({
        scope: String(row.scope),
        date: String(row.withdrawn_at),
        source: String(row.withdrawn_source ?? row.source),
        recordedAt: String(row.updated_at),
      })),
    ...stateRows(state, 'consent_withdrawals').map((row) => ({
      scope: String(row.scope),
      date: String(row.withdrawn_at),
      source: String(row.source),
      recordedAt: String(row.recorded_at),
    })),
  ];
  const latest = new Map<string, Withdrawal>();
  for (const row of evidence) {
    if (Date.parse(row.date) > Date.parse(latest.get(row.scope)?.date ?? '0001-01-01'))
      latest.set(row.scope, row);
  }
  return [...latest.values()];
}
function copiedFields(
  state: MergeSnapshot[],
  survivor: MergeRow,
  merged: MergeRow,
  stamp: string,
): CopiedField[] {
  const fields = ['given_name', 'family_name', 'email', 'phone', 'preferred_language'];
  if (survivor.zip === null || survivor.zip === merged.zip)
    fields.push(
      'zip',
      'census_block',
      'census_block_vintage',
      'place_name',
      'region_id',
      'region_source',
      'region_set_at',
    );
  if (survivor.email === null || survivor.email === merged.email) fields.push('email_verified_at');
  const sources = stateRows(state, 'field_sources');
  return fields
    .filter((field) => survivor[field] === null && merged[field] !== null)
    .map((field) => {
      const original = sources.find((row) => row.person_id === merged.id && row.field === field);
      const beforeSource =
        sources.find((row) => row.person_id === survivor.id && row.field === field) ?? null;
      const afterSource =
        field === 'email_verified_at' || field.startsWith('region_')
          ? null
          : {
              ...(original ?? {
                field,
                source: 'merge',
                confirmed_at: stamp,
                created_at: stamp,
                updated_at: stamp,
              }),
              person_id: rowValue(survivor, 'id'),
            };
      return {
        field,
        before: survivor[field] as SqlValue,
        after: merged[field] as SqlValue,
        beforeSource,
        afterSource,
      };
    });
}
export function mergeBookkeeping(
  state: MergeSnapshot[],
  survivor: MergeRow,
  merged: MergeRow,
  stamp: string,
): MergeBookkeeping {
  const rows = Object.entries(RELATED_TABLES).flatMap(([table, spec]) =>
    stateRows(state, table)
      .filter((row) => row.person_id === merged.id)
      .map((before) => ({
        table: table as keyof typeof RELATED_TABLES,
        key: String(before[spec.key]),
        before,
      })),
  );
  const suppressed: SuppressedConsent[] = [];
  for (const withdrawal of latestWithdrawals(state)) {
    for (const row of stateRows(state, 'consent_records')) {
      if (
        row.scope === withdrawal.scope &&
        row.withdrawn_at === null &&
        Date.parse(String(row.given_at)) <= Date.parse(withdrawal.date)
      ) {
        suppressed.push({
          id: String(row.id),
          before: row,
          after: {
            ...row,
            person_id: rowValue(survivor, 'id'),
            withdrawn_at: withdrawal.date,
            withdrawn_source: withdrawal.source,
            updated_at: stamp,
          },
        });
      }
    }
  }
  const admins = stateRows(state, 'staff_administrators');
  const mergedAdmin = admins.find((row) => row.person_id === merged.id);
  return {
    rows,
    fields: copiedFields(state, survivor, merged, stamp),
    archivedBefore: merged,
    archivedAfter: { ...merged, deleted_at: stamp, updated_at: stamp },
    suppressed,
    copiedAdmin:
      mergedAdmin && !admins.some((row) => row.person_id === survivor.id)
        ? { ...mergedAdmin, person_id: rowValue(survivor, 'id') }
        : null,
    reviews: stateRows(state, 'review_queue').filter((row) => row.resolved_at === null),
    withdrawalIds: stateRows(state, 'consent_withdrawals').map((row) => String(row.id)),
  };
}
export function mergeConflicts(
  state: MergeSnapshot[],
  survivor: MergeRow,
  merged: MergeRow,
): boolean {
  if (survivor.email && merged.email && survivor.email !== merged.email) return true;
  const ids = stateRows(state, 'identities');
  if (
    ids.some(
      (a) =>
        a.person_id === survivor.id &&
        ids.some((b) => b.person_id === merged.id && a.platform === b.platform),
    )
  )
    return true;
  const assignments = stateRows(state, 'committee_assignments').filter(
    (row) => row.ended_at === null,
  );
  if (
    assignments.some(
      (a) =>
        a.person_id === survivor.id &&
        assignments.some((b) => b.person_id === merged.id && a.committee_id === b.committee_id),
    )
  )
    return true;
  const events = stateRows(state, 'engagement_events').filter((row) => row.reference !== null);
  return events.some(
    (a) =>
      a.person_id === survivor.id &&
      events.some(
        (b) =>
          b.person_id === merged.id &&
          a.type === b.type &&
          a.source === b.source &&
          a.reference === b.reference,
      ),
  );
}

export function currentMergeReview(
  state: MergeSnapshot[],
  input: { reviewId?: string; survivorId: string; mergedId: string },
): boolean {
  if (!input.reviewId) return true;
  return stateRows(state, 'review_queue').some(
    (row) =>
      row.id === input.reviewId &&
      row.resolved_at === null &&
      ((row.candidate_person_id === input.survivorId &&
        row.existing_person_id === input.mergedId) ||
        (row.candidate_person_id === input.mergedId &&
          row.existing_person_id === input.survivorId)),
  );
}
