import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, Statement } from './db';
import { normalizeEmail, ownedFields } from './field-ownership';
import type { IncomingRecord, MatchDecision } from './matching';

export class ImportedMatchNeedsReview extends Error {
  constructor(readonly personId: string) {
    super('Imported source identity requires confirmation');
  }
}

export function requireConfirmedImportMatch(
  input: IncomingRecord,
  decision: MatchDecision,
  hold = false,
): void {
  if (input.source !== 'import' || !hold || decision.kind !== 'new' || !decision.withholdEmail)
    return;
  const target = decision.review.find((row) => row.reason === 'same email, unverified');
  if (target) throw new ImportedMatchNeedsReview(target.existingPersonId);
}

function reviewStatements(
  db: Db,
  personId: string,
  decision: Extract<MatchDecision, { kind: 'new' }>,
  options: { email: string | null; now: string },
): Statement[] {
  const { email, now } = options;
  return decision.review.map(({ existingPersonId, reason }) =>
    db
      .prepare(
        `INSERT INTO review_queue(id,candidate_person_id,existing_person_id,reason,details,created_at,updated_at)
     SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM review_queue WHERE resolution='kept_separate'
       AND ((candidate_person_id=? AND existing_person_id=?) OR (candidate_person_id=? AND existing_person_id=?)))
     ON CONFLICT(candidate_person_id,existing_person_id,reason) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        personId,
        existingPersonId,
        reason,
        email ? JSON.stringify({ email }) : null,
        now,
        now,
        personId,
        existingPersonId,
        existingPersonId,
        personId,
      ),
  );
}

/** Commit a new imported person together with the source identity used to resume it. */
export async function createImportedPersonAtomically(
  db: Db,
  input: IncomingRecord,
  decision: Extract<MatchDecision, { kind: 'new' }>,
  options: { now: string; warn: (message: string) => void },
): Promise<string> {
  const { now, warn } = options;
  const identity = input.identity;
  if (!identity) throw new Error('Imported person requires a source identity');
  const personId = ulid();
  const fields = ownedFields(input.source, input.fields, warn).filter(
    ([name, value]) =>
      value !== null && value !== '' && !(decision.withholdEmail && name === 'email'),
  );
  const columns = fields.map(([name]) => name);
  const statements = [
    db
      .prepare(
        `INSERT INTO people(id,created_at,updated_at${columns.map((name) => `,${name}`).join('')})
     VALUES(?,?,?${columns.map(() => ',?').join('')})`,
      )
      .bind(personId, now, now, ...fields.map(([, value]) => value)),
    ...fields.map(([name]) =>
      db
        .prepare(
          'INSERT INTO field_sources(person_id,field,source,confirmed_at,created_at,updated_at) VALUES(?,?,?,?,?,?)',
        )
        .bind(personId, name, input.source, now, now, now),
    ),
    db
      .prepare(
        `INSERT INTO identities(id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'created_by_platform',?,?)`,
      )
      .bind(
        ulid(),
        personId,
        identity.platform,
        identity.externalId,
        identity.externalEmail ?? null,
        now,
        now,
        now,
      ),
    ...reviewStatements(db, personId, decision, {
      email:
        decision.withholdEmail && input.fields.email ? normalizeEmail(input.fields.email) : null,
      now,
    }),
  ];
  await db.batch(statements);
  return personId;
}
