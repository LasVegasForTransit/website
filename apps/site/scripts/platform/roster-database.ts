import { createHash } from 'node:crypto';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { applyRosterImport } from '../../platform/roster-import';
import { copyRosterDatabase, localRosterDb } from './roster-sqlite';

export interface DatabaseRosterReport {
  beehiivRead: number;
  notionRead: number;
  peopleCreated: number;
  linked: number;
  reviewItemsCreated: number;
  consentRecordsCreated: number;
  currentRollObservations: number;
  membersRecognized: number;
  doubleOptIn: number;
  unknownMethod: number;
  skipped: number;
  errors: Array<{ source: string; recordId: string; reasons: string[] }>;
}
const COUNTS = `SELECT (SELECT count(*) FROM people) AS people,
  (SELECT count(*) FROM consent_records) AS consents,
  (SELECT count(*) FROM consent_records WHERE method='double_opt_in') AS doubleOptIn,
  (SELECT count(*) FROM consent_records WHERE method='unknown') AS unknownMethod`;
interface Counts {
  people: number;
  consents: number;
  doubleOptIn: number;
  unknownMethod: number;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function runDatabaseRoster(
  db: Db,
  records: readonly unknown[],
  options: { runId: string; now: Date; retryHeld?: boolean },
): Promise<DatabaseRosterReport> {
  const reviewsBefore = await reviewIds(db);
  const rollsBefore = await rollState(db);
  const before = await db.prepare(COUNTS).first<Counts>();
  if (!before) throw new Error('Roster database could not be counted');
  const result = await applyRosterImport(db, records, options);
  const after = await db.prepare(COUNTS).first<Counts>();
  if (!after) throw new Error('Roster database could not be counted');
  const rollsAfter = await rollState(db);
  const sources = records.map((record) =>
    record && typeof record === 'object' ? (record as Record<string, unknown>) : {},
  );
  return {
    beehiivRead: sources.filter((row) => row.source === 'beehiiv').length,
    notionRead: sources.filter((row) => row.source === 'notion_intake').length,
    peopleCreated: after.people - before.people,
    linked: result.records.filter((row) => row.action === 'linked').length,
    reviewItemsCreated: (await reviewIds(db)).filter((id) => !reviewsBefore.includes(id)).length,
    consentRecordsCreated: after.consents - before.consents,
    currentRollObservations: rollsAfter.filter(
      (row) =>
        !rollsBefore.some(
          (before) =>
            before.external_id === row.external_id && before.revision_token === row.revision_token,
        ),
    ).length,
    membersRecognized: [
      ...new Set(rollsAfter.filter((row) => row.member).map((row) => row.person_id)),
    ].filter((id) => !rollsBefore.some((row) => row.person_id === id && row.member)).length,
    doubleOptIn: after.doubleOptIn - before.doubleOptIn,
    unknownMethod: after.unknownMethod - before.unknownMethod,
    skipped: result.counts.alreadyApplied,
    errors: result.records
      .filter(
        (row) =>
          row.status === 'conflict' || row.status === 'unresolved' || row.status === 'needs_review',
      )
      .map((row) => ({
        source:
          sources[row.index]?.source === 'beehiiv'
            ? 'beehiiv'
            : sources[row.index]?.source === 'notion_intake'
              ? 'notion_intake'
              : 'unknown',
        recordId: safeId(sources[row.index]?.sourceId, row.index),
        reasons: row.reasons ?? [row.status],
      })),
  };
}
async function rollState(db: Db) {
  return (
    await db
      .prepare(
        `SELECT r.external_id,r.revision_token,r.person_id,
    (r.entitled=1 AND p.membership_status='member') AS member FROM membership_roll r JOIN people p ON p.id=r.person_id`,
      )
      .all<{
        external_id: string;
        revision_token: string;
        person_id: string;
        member: number;
      }>()
  ).results;
}
async function reviewIds(db: Db): Promise<string[]> {
  return (
    await db
      .prepare(
        "SELECT 'duplicate:'||id AS id FROM review_queue UNION ALL SELECT 'import:'||id AS id FROM roster_import_records WHERE state='held'",
      )
      .all<{ id: string }>()
  ).results.map((row) => row.id);
}
function safeId(value: unknown, index: number): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
    ? value
    : `input-row-${index + 1}`;
}
/** Exercise the same person-service apply on an isolated, consistent copy. */
export async function previewDatabaseRoster(
  db: Db,
  records: readonly unknown[],
  options: { runId: string; now: Date; retryHeld?: boolean },
) {
  const raw = await copyRosterDatabase(db);
  try {
    return await runDatabaseRoster(localRosterDb(raw), records, options);
  } finally {
    raw.close();
  }
}
export async function rosterPlan(
  db: Db,
  records: readonly unknown[],
  options: { runId: string; now: Date; retryHeld?: boolean },
) {
  const raw = await copyRosterDatabase(db);
  try {
    const matchingTables = [
      'people',
      'person_keys',
      'identities',
      'consent_records',
      'consent_withdrawals',
      'review_queue',
      'roster_import_records',
      'field_sources',
      'engagement_events',
      'membership_roll',
    ];
    const fingerprint = hash(
      matchingTables.map((table) => raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()),
    );
    const report = await runDatabaseRoster(localRosterDb(raw), records, options);
    return {
      formatVersion: 1,
      inputHash: hash({ records, retryHeld: options.retryHeld === true }),
      databaseHash: fingerprint,
      report,
    };
  } finally {
    raw.close();
  }
}
export function printRosterReport(report: DatabaseRosterReport, dryRun: boolean): string {
  return [
    `Import report (dry run: ${dryRun ? 'yes' : 'no'})`,
    `Beehiiv subscriptions read: ${report.beehiivRead}`,
    `Notion intake rows read: ${report.notionRead}`,
    `People created: ${report.peopleCreated}`,
    `Linked to existing people: ${report.linked}`,
    `Review queue items created: ${report.reviewItemsCreated}`,
    `Consent records created: ${report.consentRecordsCreated} (double opt-in: ${report.doubleOptIn}, unknown method: ${report.unknownMethod})`,
    `Current roll observations recorded: ${report.currentRollObservations}`,
    `Members recognized from the current roll: ${report.membersRecognized}`,
    `Skipped (already imported): ${report.skipped}`,
    `Errors: ${report.errors.length}`,
    ...report.errors.map(
      (error) => `${error.source} ${error.recordId}: ${error.reasons.join(', ')}`,
    ),
  ].join('\n');
}
