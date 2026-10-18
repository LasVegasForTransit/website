import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { paperToday } from '@lasvegasfortransit/platform-core/paper';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { STAFF_PERSON_SCOPE } from './staff-scope';
import { auditDenied } from './audits';

export interface PersonAttendanceInput {
  personId: string;
  eventName: string;
  eventDate: string;
  operationId: string;
}
export type AttendanceErrors = Partial<
  Record<'eventName' | 'eventDate', 'required' | 'invalid' | 'future'>
>;
type AttendanceResult =
  | { kind: 'ok'; value: { eventId: string } }
  | { kind: 'invalid'; errors: AttendanceErrors }
  | { kind: 'forbidden' | 'conflict' };
interface Receipt {
  actor_id: string;
  target_id: string;
  kind: string;
  payload: string;
  applied_at: string | null;
  result: string | null;
}
function attendanceFields(input: PersonAttendanceInput, now: Date) {
  const errors: AttendanceErrors = {};
  const eventName = input.eventName.normalize('NFC').trim().replaceAll(/\s+/gu, ' ');
  if (!eventName) errors.eventName = 'required';
  else if (input.eventName.length > 160 || /\p{Cc}/u.test(input.eventName))
    errors.eventName = 'invalid';
  const date = new Date(`${input.eventDate}T12:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.eventDate
  )
    errors.eventDate = 'invalid';
  else if (input.eventDate > paperToday(now)) errors.eventDate = 'future';
  return { errors, eventName, date };
}
function receiptResult(
  receipt: Receipt,
  actorId: string,
  input: PersonAttendanceInput,
  payload: string,
): AttendanceResult {
  return receipt.actor_id === actorId &&
    receipt.target_id === input.personId &&
    receipt.kind === 'attendance.record' &&
    receipt.payload === payload &&
    receipt.applied_at &&
    receipt.result
    ? { kind: 'ok', value: JSON.parse(receipt.result) as { eventId: string } }
    : { kind: 'conflict' };
}

/** Person scope implies attendance.record: a current member who is an administrator or shared committee lead. */
export async function recordPersonAttendance(
  db: Db,
  actor: Actor,
  input: PersonAttendanceInput,
  now: Date = new Date(),
): Promise<AttendanceResult> {
  const scope = `EXISTS(SELECT 1 FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND ${STAFF_PERSON_SCOPE})`;
  const scopeValues = [input.personId, actor.personId];
  const allowed = async () =>
    Boolean(
      await db
        .prepare(`SELECT 1 WHERE ${scope}`)
        .bind(...scopeValues)
        .first(),
    );
  if (!(await allowed())) {
    await auditDenied(db, actor.personId, 'attendance.record');
    return { kind: 'forbidden' };
  }
  const { errors, eventName, date } = attendanceFields(input, now);
  if (Object.keys(errors).length || !/^[\w:-]{1,200}$/.test(input.operationId))
    return { kind: 'invalid', errors };
  const payload = JSON.stringify({ eventName, eventDate: input.eventDate });
  const replay = async (): Promise<AttendanceResult | null> => {
    const receipt = await db
      .prepare(
        `SELECT actor_id,target_id,kind,payload,applied_at,result FROM staff_operations WHERE operation_id=? AND ${scope}`,
      )
      .bind(input.operationId, ...scopeValues)
      .first<Receipt>();
    if (!receipt) return null;
    return receiptResult(receipt, actor.personId, input, payload);
  };
  const prior = await replay();
  if (prior) return prior;
  const reference = `staff-attendance:${await digestToken(JSON.stringify([eventName.toLocaleLowerCase('en'), input.eventDate]))}`;
  const stamp = now.toISOString();
  const fence = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND kind='attendance.record' AND payload=? AND applied_at IS NULL) AND ${scope}`;
  const fresh = [input.operationId, actor.personId, input.personId, payload, ...scopeValues];
  await db.batch([
    db
      .prepare(
        `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at) SELECT ?,?,'attendance.record',?,?,? WHERE ${scope} ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(input.operationId, actor.personId, input.personId, payload, stamp, ...scopeValues),
    db
      .prepare(
        `INSERT OR IGNORE INTO engagement_events(id,person_id,type,occurred_at,source,reference,details,created_at) SELECT ?,?,'attended',?,'staff',?,?,? WHERE ${fence}`,
      )
      .bind(
        ulid(),
        input.personId,
        date.toISOString(),
        reference,
        JSON.stringify({
          actorId: actor.personId,
          eventName,
          eventDate: input.eventDate,
          datePrecision: 'day',
        }),
        stamp,
        ...fresh,
      ),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,permission,target_id,details,operation_id,occurred_at) SELECT ?,?,'attendance.record','attendance.record',?,?,?,? WHERE ${fence}`,
      )
      .bind(ulid(), actor.personId, input.personId, payload, input.operationId, stamp, ...fresh),
    db
      .prepare(
        `UPDATE staff_operations SET applied_at=?,result=(SELECT json_object('eventId',id) FROM engagement_events WHERE person_id=? AND type='attended' AND source='staff' AND reference=?) WHERE ${fence}`,
      )
      .bind(stamp, input.personId, reference, ...fresh),
  ]);
  return (await replay()) ?? { kind: (await allowed()) ? 'conflict' : 'forbidden' };
}
