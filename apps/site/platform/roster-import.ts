import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';

export type RosterImportSource = 'beehiiv' | 'notion_intake';
export type RosterConsentState = 'active' | 'withdrawn' | 'unknown';

export interface RosterImportConsent {
  state: RosterConsentState;
  /** Timestamp from the source evidence, not the import run. */
  givenAt: string | null;
  /** Timestamp from the source evidence when consent was withdrawn. */
  withdrawnAt?: string | null;
}

export interface RosterImportRecord {
  source: RosterImportSource;
  sourceId: string;
  email: string;
  newsletter: RosterImportConsent;
}

export type RosterImportClassification = 'ready' | 'unresolved' | 'conflict';

export interface RosterImportPreviewRecord {
  index: number;
  source: string | null;
  sourceId: string | null;
  email: string | null;
  classification: RosterImportClassification;
  reasons: string[];
}

export interface RosterImportPreview {
  /** This report contains member email addresses; keep it in private review storage. */
  records: RosterImportPreviewRecord[];
  counts: {
    records: number;
    importablePeople: number;
    activeMembers: number;
    formerMembers: number;
    unresolvedRecords: number;
    conflictRecords: number;
  };
}

export interface RosterImportApplyResult {
  runId: string;
  records: Array<{
    index: number;
    status: 'applied' | 'already_applied' | 'needs_review' | 'unresolved' | 'conflict';
    personId?: string;
    reasons?: string[];
  }>;
  counts: {
    applied: number;
    alreadyApplied: number;
    needsReview: number;
    unresolved: number;
    conflicts: number;
  };
}

interface PreviewOptions {
  now?: Date;
}

interface ClassifiedRecord extends RosterImportPreviewRecord {
  consentState: 'active' | 'withdrawn' | null;
  givenAt: string | null;
  withdrawnAt: string | null;
}

const SOURCES = new Set<string>(['beehiiv', 'notion_intake']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRECISE_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

type TimestampResult =
  | { value: string; issue: 'valid' }
  | { value: null; issue: 'missing' }
  | { value: null; issue: 'invalid' };

function hasValidCalendarFields(match: RegExpExecArray): boolean {
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);

  return (
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day &&
    calendar.getUTCHours() === hour &&
    calendar.getUTCMinutes() === minute &&
    calendar.getUTCSeconds() === second
  );
}

function timestamp(value: unknown): TimestampResult {
  if (value === null || value === undefined || value === '')
    return { value: null, issue: 'missing' };
  if (typeof value !== 'string') return { value: null, issue: 'invalid' };
  const match = PRECISE_TIMESTAMP.exec(value);
  if (!match || !hasValidCalendarFields(match)) return { value: null, issue: 'invalid' };
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? { value: new Date(parsed).toISOString(), issue: 'valid' }
    : { value: null, issue: 'invalid' };
}

function conflict(record: ClassifiedRecord, reason: string): void {
  record.classification = 'conflict';
  if (!record.reasons.includes(reason)) record.reasons.push(reason);
}

function unresolved(record: ClassifiedRecord, reason: string): void {
  if (record.classification !== 'conflict') record.classification = 'unresolved';
  if (!record.reasons.includes(reason)) record.reasons.push(reason);
}

function createRecord(input: Record<string, unknown> | null, index: number): ClassifiedRecord {
  const source = clean(input?.source);
  const sourceId = clean(input?.sourceId);
  const email = clean(input?.email)?.toLowerCase() ?? null;
  return {
    index,
    source,
    sourceId,
    email,
    classification: 'ready',
    reasons: [],
    consentState: null,
    givenAt: null,
    withdrawnAt: null,
  };
}

function validateIdentity(input: Record<string, unknown> | null, record: ClassifiedRecord): void {
  const source = record.source;
  const sourceId = record.sourceId;
  const email = record.email;
  if (!input || !source || !SOURCES.has(source)) conflict(record, 'source_invalid');
  if (!sourceId || sourceId.length > 200) conflict(record, 'source_id_invalid');
  if (!email || email.length > 254 || !EMAIL.test(email)) conflict(record, 'email_invalid');
}

function consentState(newsletter: Record<string, unknown> | null, record: ClassifiedRecord) {
  if (!newsletter) {
    unresolved(record, 'newsletter_evidence_missing');
    return null;
  }

  const state = newsletter.state;
  if (state === 'unknown') {
    unresolved(record, 'consent_unclear');
    return null;
  }
  if (state !== 'active' && state !== 'withdrawn') {
    unresolved(record, 'consent_state_unknown');
    return null;
  }
  record.consentState = state;
  return state;
}

function classifyGivenConsent(record: ClassifiedRecord, givenAt: unknown, now: Date): void {
  const given = timestamp(givenAt);
  switch (given.issue) {
    case 'missing':
      unresolved(record, 'consent_timestamp_missing');
      return;
    case 'invalid':
      conflict(record, 'consent_timestamp_invalid');
      return;
    case 'valid':
      if (Date.parse(given.value) > now.getTime()) conflict(record, 'consent_timestamp_future');
      else record.givenAt = given.value;
  }
}

function compareConsentEvents(record: ClassifiedRecord, withdrawnAt: string): void {
  record.withdrawnAt = withdrawnAt;
  if (!record.givenAt) return;
  if (Date.parse(withdrawnAt) < Date.parse(record.givenAt))
    conflict(record, 'withdrawal_before_consent');
}

function classifyWithdrawal(
  record: ClassifiedRecord,
  state: 'active' | 'withdrawn',
  withdrawnAt: unknown,
  now: Date,
): void {
  const withdrawn = timestamp(withdrawnAt);
  if (state === 'active') {
    if (withdrawn.issue === 'invalid') conflict(record, 'withdrawal_timestamp_invalid');
    else if (withdrawn.issue === 'valid') conflict(record, 'active_withdrawal_timestamp');
    return;
  }

  switch (withdrawn.issue) {
    case 'missing':
      unresolved(record, 'withdrawal_timestamp_missing');
      return;
    case 'invalid':
      conflict(record, 'withdrawal_timestamp_invalid');
      return;
    case 'valid':
      if (Date.parse(withdrawn.value) > now.getTime())
        conflict(record, 'withdrawal_timestamp_future');
      else compareConsentEvents(record, withdrawn.value);
  }
}

function classify(value: unknown, index: number, now: Date): ClassifiedRecord {
  const input = object(value);
  const record = createRecord(input, index);
  validateIdentity(input, record);

  const newsletter = object(input?.newsletter);
  const state = consentState(newsletter, record);
  if (!newsletter || !state) return record;

  classifyGivenConsent(record, newsletter.givenAt, now);
  classifyWithdrawal(record, state, newsletter.withdrawnAt, now);
  return record;
}

function duplicateSourceIds(records: ClassifiedRecord[]): void {
  const bySourceId = new Map<string, ClassifiedRecord[]>();
  for (const record of records) {
    if (!record.source || !record.sourceId) continue;
    const key = `${record.source}\u0000${record.sourceId}`;
    const group = bySourceId.get(key) ?? [];
    group.push(record);
    bySourceId.set(key, group);
  }
  for (const group of bySourceId.values())
    if (group.length > 1) for (const record of group) conflict(record, 'duplicate_source_id');
}

function resolveEmailGroups(records: ClassifiedRecord[]): Map<string, ClassifiedRecord[]> {
  const groups = new Map<string, ClassifiedRecord[]>();
  for (const record of records) {
    if (!record.email) continue;
    const group = groups.get(record.email) ?? [];
    group.push(record);
    groups.set(record.email, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const record of group) conflict(record, 'duplicate_email_requires_review');
  }
  return groups;
}

/** Review normalized source snapshots without creating people or consent records. */
export function previewRosterImport(
  records: readonly unknown[],
  options: PreviewOptions = {},
): RosterImportPreview {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid roster import clock');

  const classified = classifyRecords(records, now);
  const emailGroups = resolveEmailGroups(classified);
  let importablePeople = 0;
  let activeMembers = 0;
  let formerMembers = 0;

  for (const group of emailGroups.values()) {
    if (!group.length || !group.every((record) => record.classification === 'ready')) continue;
    importablePeople++;
    if (group[0]?.consentState === 'active') activeMembers++;
    else if (group[0]?.consentState === 'withdrawn') formerMembers++;
  }

  return {
    records: classified.map(
      ({ consentState: _state, givenAt: _givenAt, withdrawnAt: _withdrawnAt, ...record }) => record,
    ),
    counts: {
      records: classified.length,
      importablePeople,
      activeMembers,
      formerMembers,
      unresolvedRecords: classified.filter((record) => record.classification === 'unresolved')
        .length,
      conflictRecords: classified.filter((record) => record.classification === 'conflict').length,
    },
  };
}

function classifyRecords(records: readonly unknown[], now: Date): ClassifiedRecord[] {
  const classified = records.map((record, index) => classify(record, index, now));
  duplicateSourceIds(classified);
  resolveEmailGroups(classified);
  return classified;
}

type ApplyRecord = RosterImportApplyResult['records'][number];
type ReadyRosterRecord = ClassifiedRecord & {
  classification: 'ready';
  source: RosterImportSource;
  sourceId: string;
  email: string;
  givenAt: string;
  consentState: 'active' | 'withdrawn';
};

function isReadyRosterRecord(record: ClassifiedRecord): record is ReadyRosterRecord {
  const knownSource = record.source === 'beehiiv' || record.source === 'notion_intake';
  return (
    record.classification === 'ready' &&
    knownSource &&
    record.sourceId !== null &&
    record.email !== null &&
    record.consentState !== null &&
    record.givenAt !== null
  );
}

async function applyReadyRecord(
  db: Db,
  people: PersonService,
  record: ReadyRosterRecord,
  runId: string,
): Promise<ApplyRecord> {
  const { source, sourceId, email, givenAt, withdrawnAt } = record;
  const pendingCandidate = await db
    .prepare(
      `SELECT i.person_id FROM identities i JOIN review_queue r ON r.candidate_person_id=i.person_id
       WHERE i.platform=? AND i.external_id=? AND r.resolved_at IS NULL LIMIT 1`,
    )
    .bind(source, sourceId)
    .first<{ person_id: string }>();
  if (pendingCandidate)
    return { index: record.index, status: 'needs_review', personId: pendingCandidate.person_id };

  const { person, action } = await people.upsertFromSource({
    source: 'import',
    fields: { email },
    identity: { platform: source, externalId: sourceId, externalEmail: email },
  });
  if (action === 'created_and_queued')
    return { index: record.index, status: 'needs_review', personId: person.id };

  const consent = await people.recordImportedNewsletterConsent(person.id, {
    platform: source,
    externalId: sourceId,
    email,
    givenAt,
    withdrawnAt,
    runId,
  });
  return {
    index: record.index,
    status: consent.kind,
    personId: person.id,
  };
}

function classifyApplyRecord(record: ClassifiedRecord): ApplyRecord {
  return {
    index: record.index,
    status: record.classification === 'unresolved' ? 'unresolved' : 'conflict',
    reasons: record.reasons,
  };
}

function countApplyRecord(result: RosterImportApplyResult, record: ApplyRecord): void {
  result.records.push(record);
  switch (record.status) {
    case 'applied':
      result.counts.applied++;
      return;
    case 'already_applied':
      result.counts.alreadyApplied++;
      return;
    case 'needs_review':
      result.counts.needsReview++;
      return;
    case 'unresolved':
      result.counts.unresolved++;
      return;
    case 'conflict':
      result.counts.conflicts++;
  }
}

/** Apply only reviewed, precise consent evidence through the shared person service. */
export async function applyRosterImport(
  db: Db,
  records: readonly unknown[],
  options: PreviewOptions & { runId: string },
): Promise<RosterImportApplyResult> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid roster import clock');
  if (!options.runId.trim() || options.runId.length > 200)
    throw new Error('Roster import run ID must contain 1 to 200 characters');

  const classified = classifyRecords(records, now);
  const people = new PersonService(db);
  const result: RosterImportApplyResult = {
    runId: options.runId,
    records: [],
    counts: { applied: 0, alreadyApplied: 0, needsReview: 0, unresolved: 0, conflicts: 0 },
  };

  for (const record of classified) {
    const applied = isReadyRosterRecord(record)
      ? await applyReadyRecord(db, people, record, options.runId)
      : classifyApplyRecord(record);
    countApplyRecord(result, applied);
  }

  return result;
}
