import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import { can } from '@lasvegasfortransit/platform-core/permissions';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditDenied } from './audits';
import { normalizeEmail } from './field-ownership';

export interface ConfirmRosterSourceInput {
  recordId: string;
  personId: string;
  personUpdatedAt: string;
  evidenceHash: string;
  operationId: string;
}
export interface ConfirmRosterSourceResult {
  kind: 'applied' | 'already_applied' | 'stale' | 'forbidden';
}
interface SourceRow {
  source: string;
  sourceId: string;
  hash: string;
  personId: string | null;
  suggestedId: string | null;
  state: string;
  confirmable: number;
  email: unknown;
  evidence: string | null;
}
interface PersonRow {
  email: string | null;
  updatedAt: string;
  deletedAt: string | null;
  erasedAt: string | null;
  terminal: number;
}
interface Snapshot {
  record: SourceRow | null;
  person: PersonRow | null;
  identity: { personId: string } | null;
  competingEmail: number;
}
const STATE = `WITH selected(record_id,person_id) AS (VALUES(?,?)) SELECT json_object(
 'record',json((SELECT json_object('source',r.source,'sourceId',r.source_id,'hash',r.evidence_hash,'personId',r.person_id,'suggestedId',r.suggested_person_id,'state',r.state,'confirmable',EXISTS(SELECT 1 FROM json_each(r.reasons) WHERE value='identity_match_unconfirmed'),'email',json_extract(r.evidence,'$.email'),'evidence',r.evidence) FROM roster_import_records r WHERE r.id=(SELECT record_id FROM selected))),
 'person',json((SELECT json_object('email',p.email,'name',coalesce(p.given_name,'')||' '||coalesce(p.family_name,''),'updatedAt',p.updated_at,'deletedAt',coalesce(p.deleted_at,k.deleted_at),'erasedAt',coalesce(p.erased_at,k.erased_at),'terminal',NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id AND m.unmerged_at IS NULL AND m.erased_at IS NULL)) FROM people p JOIN person_keys k ON k.id=p.id WHERE p.id=(SELECT person_id FROM selected))),
 'identity',json((SELECT json_object('id',i.id,'personId',i.person_id,'email',i.external_email,'method',i.link_method,'updatedAt',i.updated_at) FROM identities i JOIN roster_import_records r ON r.source=i.platform AND r.source_id=i.external_id WHERE r.id=(SELECT record_id FROM selected))),
 'competingEmail',EXISTS(SELECT 1 FROM people p JOIN person_keys k ON k.id=p.id JOIN roster_import_records r ON r.id=(SELECT record_id FROM selected) WHERE p.id<>(SELECT person_id FROM selected) AND p.deleted_at IS NULL AND p.erased_at IS NULL AND k.deleted_at IS NULL AND k.erased_at IS NULL AND lower(trim(p.email))=lower(trim(json_extract(r.evidence,'$.email'))))) AS snapshot`;
const FRESH = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND kind='roster.source.confirm' AND payload=? AND result=? AND applied_at IS NULL)`;
const currentAdmin = async (db: Db, actorId: string) =>
  Boolean(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actorId).first());
function validInput(input: ConfirmRosterSourceInput) {
  return (
    Object.values(input).every(
      (value) =>
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 200 &&
        value.trim() === value,
    ) && /^[\w-]{43}$/.test(input.evidenceHash)
  );
}
function sourceMatches(row: SourceRow | null, input: ConfirmRosterSourceInput): row is SourceRow {
  return (
    row !== null &&
    row.state === 'held' &&
    row.confirmable === 1 &&
    row.personId === null &&
    row.evidence !== null &&
    row.suggestedId === input.personId &&
    row.hash === input.evidenceHash &&
    ['beehiiv', 'notion_intake'].includes(row.source) &&
    row.sourceId.length > 0 &&
    row.sourceId.length <= 200 &&
    typeof row.email === 'string' &&
    normalizeEmail(row.email).length > 0 &&
    row.email.length <= 254
  );
}
function personMatches(row: PersonRow | null, input: ConfirmRosterSourceInput, email: unknown) {
  return (
    row !== null &&
    row.deletedAt === null &&
    row.erasedAt === null &&
    row.terminal === 1 &&
    row.updatedAt === input.personUpdatedAt &&
    typeof email === 'string' &&
    row.email !== null &&
    normalizeEmail(row.email) === normalizeEmail(email)
  );
}
async function appliedReceipt(
  db: Db,
  actorId: string,
  input: ConfirmRosterSourceInput,
  payload: string,
) {
  return db
    .prepare(
      `SELECT 1 FROM staff_operations op JOIN people p ON p.id=op.target_id JOIN person_keys k ON k.id=p.id
    JOIN roster_import_records r ON r.id=? AND r.person_id=p.id AND r.evidence_hash=? AND r.state<>'erased'
    JOIN identities i ON i.platform=r.source AND i.external_id=r.source_id AND i.person_id=p.id
    WHERE op.operation_id=? AND op.actor_id=? AND op.target_id=? AND op.kind='roster.source.confirm' AND op.payload=? AND op.applied_at IS NOT NULL
      AND p.deleted_at IS NULL AND p.erased_at IS NULL AND k.deleted_at IS NULL AND k.erased_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id AND m.unmerged_at IS NULL AND m.erased_at IS NULL) AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(
      input.recordId,
      input.evidenceHash,
      input.operationId,
      actorId,
      input.personId,
      payload,
      actorId,
    )
    .first();
}

async function writeConfirmation(
  db: Db,
  actorId: string,
  input: ConfirmRosterSourceInput,
  expected: { snapshot: string; row: SourceRow; payload: string },
) {
  const { row, payload } = expected;
  const stamp = new Date().toISOString(),
    identityId = ulid();
  const result = JSON.stringify({ recordId: input.recordId, personId: input.personId, identityId });
  const fresh = [input.operationId, actorId, input.personId, payload, result];
  await db.batch([
    db
      .prepare(
        `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,result,created_at)
      SELECT ?,?,'roster.source.confirm',?,?,?,? WHERE (${STATE})=? AND ${STAFF_ADMIN_SCOPE} ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        input.operationId,
        actorId,
        input.personId,
        payload,
        result,
        stamp,
        input.recordId,
        input.personId,
        expected.snapshot,
        actorId,
      ),
    db
      .prepare(
        `INSERT INTO identities(id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at)
      SELECT ?,?,?,?,?,?,'staff_confirmed',?,? WHERE ${FRESH} ON CONFLICT(platform,external_id) DO NOTHING`,
      )
      .bind(
        identityId,
        input.personId,
        row.source,
        row.sourceId,
        String(row.email),
        stamp,
        stamp,
        stamp,
        ...fresh,
      ),
    db
      .prepare(
        `UPDATE roster_import_records SET person_id=? WHERE id=? AND evidence_hash=? AND state='held' AND person_id IS NULL AND ${FRESH}`,
      )
      .bind(input.personId, input.recordId, input.evidenceHash, ...fresh),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,permission,target_id,details,operation_id,occurred_at)
      SELECT ?,?,'roster.source.confirm','review_queue.resolve',?,?,?,? WHERE ${FRESH}`,
      )
      .bind(
        ulid(),
        actorId,
        input.personId,
        JSON.stringify({ recordId: input.recordId }),
        input.operationId,
        stamp,
        ...fresh,
      ),
    db
      .prepare(`UPDATE staff_operations SET applied_at=? WHERE operation_id=? AND ${FRESH}`)
      .bind(stamp, input.operationId, ...fresh),
  ]);
}

/** Confirm source ownership only; a separately reviewed retry applies its original evidence. */
export async function confirmRosterSource(
  db: Db,
  actor: Actor,
  input: ConfirmRosterSourceInput,
): Promise<ConfirmRosterSourceResult> {
  if (!can(actor, 'review_queue.resolve') || !(await currentAdmin(db, actor.personId))) {
    await auditDenied(db, actor.personId, 'review_queue.resolve');
    return { kind: 'forbidden' };
  }
  if (!validInput(input)) return { kind: 'stale' };
  const payload = JSON.stringify({
    recordId: input.recordId,
    evidenceHash: input.evidenceHash,
    personUpdatedAt: input.personUpdatedAt,
  });
  if (await appliedReceipt(db, actor.personId, input, payload)) return { kind: 'already_applied' };
  const loaded = await db
    .prepare(STATE)
    .bind(input.recordId, input.personId)
    .first<{ snapshot: string }>();
  if (!loaded) return { kind: 'stale' };
  const snapshot = JSON.parse(loaded.snapshot) as Snapshot;
  if (
    !sourceMatches(snapshot.record, input) ||
    !personMatches(snapshot.person, input, snapshot.record.email) ||
    snapshot.identity !== null ||
    snapshot.competingEmail !== 0
  )
    return { kind: 'stale' };
  await writeConfirmation(db, actor.personId, input, {
    snapshot: loaded.snapshot,
    row: snapshot.record,
    payload,
  });
  if (await appliedReceipt(db, actor.personId, input, payload)) return { kind: 'applied' };
  return { kind: (await currentAdmin(db, actor.personId)) ? 'stale' : 'forbidden' };
}
