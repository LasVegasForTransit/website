import { ulid } from '@lasvegasfortransit/platform-core/ids';
import {
  blankPaperRow,
  type PaperInput,
  type PaperRow,
} from '@lasvegasfortransit/platform-core/paper';
import { normalizePhone } from '@lasvegasfortransit/platform-core/join-form';
import { decideMatch } from './matching';
import { ownedFields, normalizeEmail } from './field-ownership';
import type { Db, SqlValue } from './db';
import type { PersonFields } from './person-service';
export interface PaperRecord {
  personId: string;
  row: PaperRow;
  create: boolean;
  withholdEmail: boolean;
  fields: PersonFields;
  check: { sql: string; values: SqlValue[] };
  consentId: string;
}
export const PAPER_SCOPE = `EXISTS(SELECT 1 FROM people actor WHERE actor.id=? AND actor.deleted_at IS NULL AND actor.membership_status='member'
 AND (EXISTS(SELECT 1 FROM staff_administrators WHERE person_id=actor.id) OR EXISTS(SELECT 1 FROM identities WHERE person_id=actor.id AND platform='google_workspace') OR EXISTS(SELECT 1 FROM committee_assignments WHERE person_id=actor.id AND ended_at IS NULL)))`;
export async function paperAllowed(db: Db, actorId: string): Promise<boolean> {
  return Boolean(await db.prepare(`SELECT 1 WHERE ${PAPER_SCOPE}`).bind(actorId).first());
}
async function recordPlan(db: Db, row: PaperRow): Promise<PaperRecord> {
  const fields: PersonFields = Object.fromEntries(
    ownedFields(
      'paper',
      {
        given_name: row.givenName.trim() || null,
        family_name: row.familyName.trim() || null,
        email: row.email ? normalizeEmail(row.email) : null,
        phone: row.phone ? normalizePhone(row.phone) : null,
      },
      () => undefined,
    ).filter(([, value]) => value !== null),
  );
  const decision = await decideMatch(db, { source: 'paper', fields });
  const consentId = ulid();
  if (decision.kind === 'existing') {
    const person = await db
      .prepare(
        'SELECT given_name,family_name,email,phone,updated_at FROM people WHERE id=? AND deleted_at IS NULL',
      )
      .bind(decision.personId)
      .first<{
        given_name: string | null;
        family_name: string | null;
        email: string | null;
        phone: string | null;
        updated_at: string;
      }>();
    if (!person) throw new Error('Paper matching changed; please retry');
    const empty = Object.fromEntries(
      Object.entries(fields).filter(([name]) => person[name as keyof typeof person] === null),
    );
    return {
      personId: decision.personId,
      row,
      create: false,
      withholdEmail: false,
      fields: empty,
      consentId,
      check: {
        sql: 'EXISTS(SELECT 1 FROM people WHERE id=? AND deleted_at IS NULL AND email=? AND email_verified_at IS NOT NULL AND updated_at=?)',
        values: [decision.personId, fields.email ?? null, person.updated_at],
      },
    };
  }
  const email = fields.email ?? null;
  if (decision.withholdEmail) delete fields.email;
  return {
    personId: ulid(),
    row,
    create: true,
    withholdEmail: decision.withholdEmail,
    fields,
    consentId,
    check: {
      sql: decision.withholdEmail
        ? 'EXISTS(SELECT 1 FROM people WHERE email=? AND deleted_at IS NULL AND email_verified_at IS NULL)'
        : 'NOT EXISTS(SELECT 1 FROM people WHERE email=? AND deleted_at IS NULL)',
      values: [email],
    },
  };
}
export async function planPaperRows(db: Db, input: PaperInput): Promise<PaperRecord[]> {
  const records: PaperRecord[] = [];
  for (const row of input.rows) if (!blankPaperRow(row)) records.push(await recordPlan(db, row));
  return records;
}
