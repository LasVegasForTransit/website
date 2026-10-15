import { nowIso, ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, Statement } from './db';
import { importedConsentGuard, importedConsentChanged } from './imported-consent-guard';
import { normalizeEmail } from './field-ownership';
import type { ConsentMethod } from './person-service';

export interface ImportedNewsletterEvidence {
  platform: 'beehiiv' | 'notion_intake';
  externalId: string;
  email: string;
  givenAt: string;
  withdrawnAt: string | null;
  runId: string;
  method?: ConsentMethod;
  wordingVersion?: string | null;
  withdrawnTimeBasis?: 'choice' | 'observed';
}

export type ImportedNewsletterStatus = 'applied' | 'already_applied' | 'needs_review' | 'conflict';

interface ProviderIdentity {
  id: string;
  external_email: string | null;
}

interface ConsentRow {
  id: string;
  withdrawn_at: string | null;
  method: string;
  wording_version: string | null;
}

interface ConsentWriteContext {
  personId: string;
  identityId: string;
  consentId: string;
  existing: ConsentRow | null;
  evidence: ImportedNewsletterEvidence;
  now: string;
  activeConsents: { id: string }[];
}

async function providerIdentity(
  db: Db,
  personId: string,
  input: ImportedNewsletterEvidence,
): Promise<ProviderIdentity | null> {
  const identity = await db
    .prepare(
      `SELECT i.id, i.external_email FROM identities i JOIN people p ON p.id=i.person_id
       WHERE i.person_id=? AND i.platform=? AND i.external_id=? AND p.deleted_at IS NULL`,
    )
    .bind(personId, input.platform, input.externalId)
    .first<ProviderIdentity>();
  if (!identity || normalizeEmail(identity.external_email ?? '') !== normalizeEmail(input.email))
    return null;
  return identity;
}

async function hasPendingDuplicateReview(db: Db, personId: string): Promise<boolean> {
  return Boolean(
    await db
      .prepare(
        'SELECT 1 AS pending FROM review_queue WHERE (candidate_person_id=? OR existing_person_id=?) AND resolved_at IS NULL LIMIT 1',
      )
      .bind(personId, personId)
      .first(),
  );
}

async function importedConsent(
  db: Db,
  identityId: string,
  givenAt: string,
): Promise<ConsentRow | null> {
  return db
    .prepare(
      `SELECT id,withdrawn_at,method,wording_version FROM consent_records
       WHERE origin_identity_id=? AND scope='newsletter' AND given_at=?`,
    )
    .bind(identityId, givenAt)
    .first<ConsentRow>();
}

async function hasNewerWithdrawal(db: Db, personId: string, givenAt: string): Promise<boolean> {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 AS stale FROM (
          SELECT withdrawn_at AS at FROM consent_records
            WHERE person_id=? AND scope='newsletter' AND withdrawn_at IS NOT NULL
          UNION ALL
          SELECT withdrawn_at AS at FROM consent_withdrawals
            WHERE person_id=? AND scope='newsletter'
        ) WHERE julianday(at)>=julianday(?) LIMIT 1`,
      )
      .bind(personId, personId, givenAt)
      .first(),
  );
}

async function activeBeforeWithdrawal(db: Db, personId: string, withdrawnAt: string) {
  return (
    await db
      .prepare(
        `SELECT id FROM consent_records WHERE person_id=? AND scope='newsletter'
          AND withdrawn_at IS NULL AND julianday(given_at)<=julianday(?)`,
      )
      .bind(personId, withdrawnAt)
      .all<{ id: string }>()
  ).results;
}

function insertImportedConsent(db: Db, context: ConsentWriteContext): Statement {
  const { personId, identityId, consentId, evidence, now } = context;
  const guard = importedConsentGuard(personId, identityId, evidence);
  return db
    .prepare(
      `INSERT INTO consent_records
        (id,person_id,scope,given_at,source,method,wording_version,withdrawn_at,withdrawn_source,
         created_at,updated_at,origin_identity_id,import_run_id)
       SELECT ?,?,'newsletter',?,'import',?,?, ?,?,?, ?,?,? WHERE ${guard.sql}
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      consentId,
      personId,
      evidence.givenAt,
      evidence.method ?? 'unknown',
      evidence.wordingVersion ?? null,
      evidence.withdrawnAt,
      evidence.withdrawnAt ? 'import' : null,
      now,
      now,
      identityId,
      evidence.runId,
      ...guard.values,
    );
}

function updateImportedWithdrawal(db: Db, context: ConsentWriteContext): Statement {
  const { personId, identityId, consentId, evidence, now } = context;
  const guard = importedConsentGuard(personId, identityId, evidence);
  return db
    .prepare(
      `UPDATE consent_records SET withdrawn_at=?,withdrawn_source='import',import_run_id=?,updated_at=?
    WHERE id=? AND person_id=? AND origin_identity_id=? AND withdrawn_at IS NULL AND ${guard.sql}`,
    )
    .bind(
      evidence.withdrawnAt,
      evidence.runId,
      now,
      consentId,
      personId,
      identityId,
      ...guard.values,
    );
}
function updateOlderActiveConsent(
  db: Db,
  context: ConsentWriteContext,
  consentId: string,
): Statement {
  const { personId, identityId, evidence, now } = context;
  const guard = importedConsentGuard(personId, identityId, evidence);
  return db
    .prepare(
      `UPDATE consent_records SET withdrawn_at=?,withdrawn_source='import',updated_at=?
    WHERE id=? AND person_id=? AND withdrawn_at IS NULL AND julianday(given_at)<=julianday(?) AND ${guard.sql}`,
    )
    .bind(evidence.withdrawnAt, now, consentId, personId, evidence.withdrawnAt, ...guard.values);
}
function recordWithdrawal(db: Db, context: ConsentWriteContext): Statement {
  const { personId, identityId, evidence, now } = context;
  const guard = importedConsentGuard(personId, identityId, evidence);
  return db
    .prepare(
      `INSERT INTO consent_withdrawals(id,person_id,origin_person_id,scope,source,withdrawn_at,recorded_at)
    SELECT ?,?,?,'newsletter','import',?,? WHERE ${guard.sql}
    ON CONFLICT(origin_person_id,scope,source,withdrawn_at) DO NOTHING`,
    )
    .bind(ulid(), personId, personId, evidence.withdrawnAt, now, ...guard.values);
}
function recordEngagementEvent(
  db: Db,
  context: ConsentWriteContext,
  event: 'subscribed' | 'unsubscribed',
  consentId = context.consentId,
): Statement {
  const { personId, identityId, evidence, now } = context;
  const guard = importedConsentGuard(personId, identityId, evidence);
  const occurredAt = event === 'subscribed' ? 'given_at' : 'withdrawn_at';
  const withdrawnGuard = event === 'unsubscribed' ? ' AND withdrawn_at IS NOT NULL' : '';
  return db
    .prepare(
      `INSERT OR IGNORE INTO engagement_events(id,person_id,type,occurred_at,source,reference,details,created_at)
    SELECT ?,?, ?,${occurredAt},'import',id,NULL,? FROM consent_records
    WHERE id=? AND person_id=?${withdrawnGuard} AND ${guard.sql}`,
    )
    .bind(ulid(), personId, event, now, consentId, personId, ...guard.values);
}

function writeStatements(db: Db, context: ConsentWriteContext): Statement[] {
  const { consentId, existing, evidence, activeConsents } = context;
  const withdrawnAt = evidence.withdrawnAt;
  const statements = [
    existing ? updateImportedWithdrawal(db, context) : insertImportedConsent(db, context),
  ];
  if (!withdrawnAt) {
    statements.push(recordEngagementEvent(db, context, 'subscribed'));
    return statements;
  }

  statements.push(...activeConsents.map(({ id }) => updateOlderActiveConsent(db, context, id)));
  statements.push(recordWithdrawal(db, context));
  statements.push(recordEngagementEvent(db, context, 'subscribed'));
  for (const { id } of activeConsents) {
    statements.push(recordEngagementEvent(db, context, 'unsubscribed', id));
  }
  if (!activeConsents.some(({ id }) => id === consentId))
    statements.push(recordEngagementEvent(db, context, 'unsubscribed'));
  return statements;
}

function evidenceChanged(existing: ConsentRow, input: ImportedNewsletterEvidence): boolean {
  const method = input.method ?? 'unknown',
    wording = input.wordingVersion ?? null;
  return (
    (method !== 'unknown' && existing.method !== method) ||
    (wording !== null && wording !== '' && existing.wording_version !== wording)
  );
}

async function existingImportStatus(
  db: Db,
  personId: string,
  input: ImportedNewsletterEvidence,
  existing: ConsentRow | null,
): Promise<ImportedNewsletterStatus | null> {
  if (existing && evidenceChanged(existing, input)) return 'conflict';
  if (existing?.withdrawn_at === input.withdrawnAt) return 'already_applied';
  if (existing && (existing.withdrawn_at !== null || input.withdrawnAt === null)) return 'conflict';
  if (
    !existing &&
    input.withdrawnAt === null &&
    (await hasNewerWithdrawal(db, personId, input.givenAt))
  )
    return 'conflict';

  return null;
}

/** Apply historical newsletter evidence using the source identity as its replay key. */
export async function applyImportedNewsletterConsent(
  db: Db,
  personId: string,
  input: ImportedNewsletterEvidence,
): Promise<ImportedNewsletterStatus> {
  // A status observation is not a dated withdrawal choice. Staff must resolve
  // its ordering before an import may alter membership.
  if (input.withdrawnAt && input.withdrawnTimeBasis === 'observed') return 'needs_review';
  const identity = await providerIdentity(db, personId, input);
  if (!identity) return 'conflict';
  if (await hasPendingDuplicateReview(db, personId)) return 'needs_review';

  const existing = await importedConsent(db, identity.id, input.givenAt);
  const held = await existingImportStatus(db, personId, input, existing);
  if (held) return held;

  const now = nowIso();
  const consentId = existing?.id ?? `import:${identity.id}:${input.givenAt}`;
  const activeConsents = input.withdrawnAt
    ? await activeBeforeWithdrawal(db, personId, input.withdrawnAt)
    : [];
  const result = await db.batch(
    writeStatements(db, {
      personId,
      identityId: identity.id,
      consentId,
      existing,
      evidence: input,
      now,
      activeConsents,
    }),
  );
  if (!importedConsentChanged(result[0]))
    return (await hasPendingDuplicateReview(db, personId)) ? 'needs_review' : 'conflict';
  return 'applied';
}
