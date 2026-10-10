import { nowIso, ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, Statement } from './db';
import { normalizeEmail } from './field-ownership';

export interface ImportedNewsletterEvidence {
  platform: 'beehiiv' | 'notion_intake';
  externalId: string;
  email: string;
  givenAt: string;
  withdrawnAt: string | null;
  runId: string;
}

export type ImportedNewsletterStatus = 'applied' | 'already_applied' | 'needs_review' | 'conflict';

interface ProviderIdentity {
  id: string;
  external_email: string | null;
}

interface ConsentRow {
  id: string;
  withdrawn_at: string | null;
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
        'SELECT 1 AS pending FROM review_queue WHERE candidate_person_id=? AND resolved_at IS NULL LIMIT 1',
      )
      .bind(personId)
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
      `SELECT id,withdrawn_at FROM consent_records
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
  return db
    .prepare(
      `INSERT INTO consent_records
        (id,person_id,scope,given_at,source,method,wording_version,withdrawn_at,withdrawn_source,
         created_at,updated_at,origin_identity_id,import_run_id)
       VALUES (?,?,'newsletter',?,'import','unknown',NULL,?,?,?, ?,?,?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      consentId,
      personId,
      evidence.givenAt,
      evidence.withdrawnAt,
      evidence.withdrawnAt ? 'import' : null,
      now,
      now,
      identityId,
      evidence.runId,
    );
}

function updateImportedWithdrawal(
  db: Db,
  consentId: string,
  input: ImportedNewsletterEvidence,
  now: string,
): Statement {
  return db
    .prepare(
      `UPDATE consent_records SET withdrawn_at=?,withdrawn_source='import',import_run_id=?,updated_at=?
       WHERE id=? AND withdrawn_at IS NULL`,
    )
    .bind(input.withdrawnAt, input.runId, now, consentId);
}

function updateOlderActiveConsent(
  db: Db,
  consentId: string,
  withdrawnAt: string,
  now: string,
): Statement {
  return db
    .prepare(
      `UPDATE consent_records SET withdrawn_at=?,withdrawn_source='import',updated_at=?
       WHERE id=? AND withdrawn_at IS NULL AND julianday(given_at)<=julianday(?)`,
    )
    .bind(withdrawnAt, now, consentId, withdrawnAt);
}

function recordWithdrawal(db: Db, personId: string, withdrawnAt: string, now: string): Statement {
  return db
    .prepare(
      `INSERT INTO consent_withdrawals(id,person_id,origin_person_id,scope,source,withdrawn_at,recorded_at)
       VALUES (?,?,?,'newsletter','import',?,?)
       ON CONFLICT(origin_person_id,scope,source,withdrawn_at) DO NOTHING`,
    )
    .bind(ulid(), personId, personId, withdrawnAt, now);
}

function recordEngagementEvent(
  db: Db,
  input: {
    personId: string;
    event: 'subscribed' | 'unsubscribed';
    consentId: string;
    now: string;
  },
): Statement {
  const { personId, event, consentId, now } = input;
  const occurredAt = event === 'subscribed' ? 'given_at' : 'withdrawn_at';
  const withdrawnGuard = event === 'unsubscribed' ? ' AND withdrawn_at IS NOT NULL' : '';
  return db
    .prepare(
      `INSERT OR IGNORE INTO engagement_events(id,person_id,type,occurred_at,source,reference,details,created_at)
       SELECT ?,?, ?,${occurredAt},'import',id,NULL,? FROM consent_records
       WHERE id=? AND person_id=?${withdrawnGuard}`,
    )
    .bind(ulid(), personId, event, now, consentId, personId);
}

function writeStatements(db: Db, context: ConsentWriteContext): Statement[] {
  const { personId, consentId, existing, evidence, now, activeConsents } = context;
  const withdrawnAt = evidence.withdrawnAt;
  const statements = [
    existing
      ? updateImportedWithdrawal(db, consentId, evidence, now)
      : insertImportedConsent(db, context),
  ];
  if (!withdrawnAt) {
    statements.push(recordEngagementEvent(db, { personId, event: 'subscribed', consentId, now }));
    return statements;
  }

  statements.push(
    ...activeConsents.map(({ id }) => updateOlderActiveConsent(db, id, withdrawnAt, now)),
  );
  statements.push(recordWithdrawal(db, personId, withdrawnAt, now));
  statements.push(recordEngagementEvent(db, { personId, event: 'subscribed', consentId, now }));
  for (const { id } of activeConsents) {
    statements.push(
      recordEngagementEvent(db, { personId, event: 'unsubscribed', consentId: id, now }),
    );
  }
  if (!activeConsents.some(({ id }) => id === consentId))
    statements.push(recordEngagementEvent(db, { personId, event: 'unsubscribed', consentId, now }));
  return statements;
}

/** Apply historical newsletter evidence using the source identity as its replay key. */
export async function applyImportedNewsletterConsent(
  db: Db,
  personId: string,
  input: ImportedNewsletterEvidence,
): Promise<ImportedNewsletterStatus> {
  const identity = await providerIdentity(db, personId, input);
  if (!identity) return 'conflict';
  if (await hasPendingDuplicateReview(db, personId)) return 'needs_review';

  const existing = await importedConsent(db, identity.id, input.givenAt);
  if (existing?.withdrawn_at === input.withdrawnAt) return 'already_applied';
  if (existing && (existing.withdrawn_at !== null || input.withdrawnAt === null)) return 'conflict';
  if (
    !existing &&
    input.withdrawnAt === null &&
    (await hasNewerWithdrawal(db, personId, input.givenAt))
  )
    return 'conflict';

  const now = nowIso();
  const consentId = existing?.id ?? `import:${identity.id}:${input.givenAt}`;
  const activeConsents = input.withdrawnAt
    ? await activeBeforeWithdrawal(db, personId, input.withdrawnAt)
    : [];
  await db.batch(
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
  return 'applied';
}
