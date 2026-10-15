import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { recordCurrentMembershipRoll } from '@lasvegasfortransit/platform-storage/membership-roll';
import { upsertRosterPerson, knownRollResponse } from './roster-matching';
import { rosterReceipt, rosterObject, consentMethod } from './roster-evidence';
import {
  classifyRecords,
  isReadyRosterRecord,
  timestamp,
  type ClassifiedRecord,
  type ReadyRosterRecord,
  type RosterImportSource,
  type RosterImportApplyResult,
  type PreviewOptions,
} from './roster-classification';
export * from './roster-classification';
type ApplyRecord = RosterImportApplyResult['records'][number];
async function applyReadyRecord(
  db: Db,
  people: PersonService,
  record: ReadyRosterRecord,
  options: { runId: string; input: unknown },
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

  const matched = await upsertRosterPerson(people, record);
  if ('held' in matched) return matched.held;
  const { person, action } = matched;
  if (action === 'created_and_queued')
    return { index: record.index, status: 'needs_review', personId: person.id, action };

  const consent = await people.recordImportedNewsletterConsent(person.id, {
    platform: source,
    externalId: sourceId,
    email,
    givenAt,
    withdrawnAt,
    runId: options.runId,
    method: consentMethod(rosterObject(rosterObject(options.input).newsletter).method),
    wordingVersion:
      typeof rosterObject(rosterObject(options.input).newsletter).wordingVersion === 'string'
        ? String(rosterObject(rosterObject(options.input).newsletter).wordingVersion)
        : null,
  });
  return {
    index: record.index,
    status: consent.kind,
    personId: person.id,
    action,
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

function validIdentity(
  record: ClassifiedRecord,
): record is ClassifiedRecord & { source: RosterImportSource; sourceId: string; email: string } {
  return (
    !record.reasons.some((reason) =>
      [
        'source_invalid',
        'source_id_invalid',
        'email_invalid',
        'name_invalid',
        'duplicate_source_id',
      ].includes(reason),
    ) &&
    (record.source === 'beehiiv' || record.source === 'notion_intake') &&
    record.sourceId !== null &&
    record.email !== null
  );
}
async function importPerson(
  db: Db,
  people: PersonService,
  record: ClassifiedRecord,
  options: { runId: string; input: unknown },
): Promise<ApplyRecord> {
  if (!validIdentity(record)) return classifyApplyRecord(record);
  const erased = await db
    .prepare(
      'SELECT k.id FROM identities i JOIN person_keys k ON k.id=i.person_id WHERE i.platform=? AND i.external_id=? AND (k.erased_at IS NOT NULL OR k.deleted_at IS NOT NULL)',
    )
    .bind(record.source, record.sourceId)
    .first();
  if (erased) return { index: record.index, status: 'already_applied' };
  if (isReadyRosterRecord(record)) return await applyReadyRecord(db, people, record, options);
  const matched = await upsertRosterPerson(people, record);
  if ('held' in matched) return matched.held;
  const { person, action } = matched;
  if (record.roll) {
    const status =
      action === 'created_and_queued'
        ? 'needs_review'
        : await recordCurrentMembershipRoll(db, {
            personId: person.id,
            externalId: record.sourceId,
            ...record.roll,
          });
    if (record.roll.status === 'active' && record.classification === 'ready')
      return { index: record.index, status, personId: person.id, action };
  }
  if (await knownRollResponse(db, record, { person, input: options.input }))
    return { index: record.index, status: 'applied', personId: person.id, action, reasons: [] };
  return { ...classifyApplyRecord(record), personId: person.id, action };
}
async function formEvent(
  people: PersonService,
  record: ClassifiedRecord,
  applied: ApplyRecord,
  options: { evidence: Record<string, unknown>; now: Date },
): Promise<void> {
  const form = rosterObject(options.evidence.form);
  const value = typeof form.submittedAt === 'string' ? form.submittedAt : form.submissionMinute;
  const minute =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      ? value
      : null;
  const submitted = timestamp(
    minute ? minute.replace(/(T\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/, '$1:00$2') : value,
  );
  if (
    record.source !== 'notion_intake' ||
    !applied.personId ||
    submitted.issue !== 'valid' ||
    Date.parse(submitted.value) > options.now.getTime()
  )
    return;
  await people.recordEngagement(applied.personId, {
    type:
      applied.status === 'applied' && form.membershipAffirmative === true
        ? 'joined'
        : 'form_response',
    occurredAt: minute ?? submitted.value,
    source: 'import',
    reference: `notion_intake:${record.sourceId}`,
    details: { form },
  });
}
async function erasedSource(db: Db, record: ClassifiedRecord): Promise<boolean> {
  return Boolean(
    await db
      .prepare(
        "SELECT 1 WHERE EXISTS(SELECT 1 FROM identities i JOIN person_keys k ON k.id=i.person_id WHERE i.platform=? AND i.external_id=? AND k.erased_at IS NOT NULL) OR EXISTS(SELECT 1 FROM roster_import_records WHERE source=? AND source_id=? AND state='erased')",
      )
      .bind(record.source, record.sourceId, record.source, record.sourceId)
      .first(),
  );
}
async function saveRosterReceipt(
  db: Db,
  record: ClassifiedRecord,
  applied: ApplyRecord,
  options: { receipt: Awaited<ReturnType<typeof rosterReceipt>>; now: Date },
): Promise<void> {
  const { receipt } = options;
  const held = applied.status !== 'applied';
  await db
    .prepare(
      `INSERT INTO roster_import_records(id,source,source_id,evidence_hash,person_id,suggested_person_id,state,reasons,evidence,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,source_id,evidence_hash) DO UPDATE SET person_id=excluded.person_id,suggested_person_id=excluded.suggested_person_id,state=excluded.state,reasons=excluded.reasons WHERE roster_import_records.state='held'`,
    )
    .bind(
      crypto.randomUUID(),
      record.source,
      record.sourceId,
      receipt.hash,
      applied.personId ?? null,
      applied.suggestedPersonId ?? null,
      held ? 'held' : 'applied',
      JSON.stringify(
        applied.reasons ?? (record.reasons.length ? record.reasons : held ? [applied.status] : []),
      ),
      receipt.encoded,
      options.now.toISOString(),
    )
    .run();
  if (applied.status === 'applied')
    await db
      .prepare(
        `UPDATE roster_import_records SET state='superseded' WHERE source=? AND source_id=? AND evidence_hash<>? AND state='held'`,
      )
      .bind(record.source, record.sourceId, receipt.hash)
      .run();
}
async function importRecord(
  db: Db,
  people: PersonService,
  record: ClassifiedRecord,
  options: { runId: string; input: unknown; now: Date; retryHeld?: boolean },
): Promise<ApplyRecord> {
  const receipt = await rosterReceipt(db, options.input);
  if (receipt.prior && !(options.retryHeld && receipt.prior.state === 'held'))
    return {
      index: record.index,
      status: 'already_applied',
      ...(receipt.prior.person_id ? { personId: receipt.prior.person_id } : {}),
    };
  if (await erasedSource(db, record)) return { index: record.index, status: 'already_applied' };
  const applied = await importPerson(db, people, record, options);
  if (applied.status === 'already_applied' && !applied.personId) return applied;
  if (applied.status === 'already_applied') applied.status = 'applied';
  await formEvent(people, record, applied, { evidence: receipt.evidence, now: options.now });
  if (
    !record.sourceId ||
    record.sourceId.length > 200 ||
    !['beehiiv', 'notion_intake'].includes(record.source ?? '')
  )
    return applied;
  await saveRosterReceipt(db, record, applied, { receipt, now: options.now });
  return applied;
}
/** Apply reviewed evidence, retaining unclear source records for staff. */
export async function applyRosterImport(
  db: Db,
  records: readonly unknown[],
  options: PreviewOptions & { runId: string; retryHeld?: boolean },
): Promise<RosterImportApplyResult> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid roster import clock');
  if (!options.runId.trim() || options.runId.length > 200)
    throw new Error('Roster import run ID must contain 1 to 200 characters');
  const people = new PersonService(db),
    result: RosterImportApplyResult = {
      runId: options.runId,
      records: [],
      counts: { applied: 0, alreadyApplied: 0, needsReview: 0, unresolved: 0, conflicts: 0 },
    };
  for (const record of classifyRecords(records, now, true))
    countApplyRecord(
      result,
      await importRecord(db, people, record, {
        input: records[record.index],
        runId: options.runId,
        now,
        retryHeld: options.retryHeld === true,
      }),
    );
  return result;
}
