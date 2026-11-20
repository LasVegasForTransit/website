// Members ask to join a committee, through a posted role or the committee itself. A committee
// lead or staff administrator accepts, which creates an ordinary committee assignment (so Google
// and Discord access follow the existing reconcilers), or declines.
import { leadCommitteeIds } from '@lasvegasfortransit/platform-core/permissions';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, SqlValue } from './db';
import { CommitteeService } from './committees';

export type ApplicationState = 'submitted' | 'accepted' | 'declined' | 'withdrawn';
export const NOTE_LIMIT = 2000;
export const AVAILABILITY_LIMIT = 500;
/** Times of week a member can say they're usually free, in display order. */
export const AVAILABLE_TIMES = [
  'weekday-mornings',
  'weekday-afternoons',
  'weekday-evenings',
  'weekend-mornings',
  'weekend-afternoons',
  'weekend-evenings',
] as const;
export type AvailableTime = (typeof AVAILABLE_TIMES)[number];
export function isAvailableTime(value: string): value is AvailableTime {
  return (AVAILABLE_TIMES as readonly string[]).includes(value);
}
const ROLE_SLUG = /^[a-z0-9-]{1,100}$/;
/** Days an application can wait before the queue marks it overdue. */
export const RESPONSE_DAYS = 3;

export interface ApplicationTarget {
  committeeId: string | null;
  roleSlug: string | null;
  roleTitle: string | null;
}
export interface OpenCommittee {
  id: string;
  name: string;
  description: string;
  timeCommitment: string;
}
export interface MemberApplication {
  id: string;
  committeeId: string | null;
  committeeName: string | null;
  roleSlug: string | null;
  roleTitle: string | null;
  state: ApplicationState;
  submittedAt: string;
  decidedAt: string | null;
  decisionNote: string;
}
export interface StaffApplication extends MemberApplication {
  personId: string;
  givenName: string | null;
  familyName: string | null;
  note: string;
  availableTimes: AvailableTime[];
  availability: string;
  waitingDays: number;
  overdue: boolean;
  decidedByName: string | null;
}
export type SubmitOutcome =
  | { kind: 'ok'; id: string }
  | { kind: 'invalid' | 'duplicate' | 'already_on_committee' | 'unavailable' };
export type DecisionOutcome =
  { kind: 'ok' } | { kind: 'forbidden' | 'conflict' | 'invalid' | 'not_found' };

interface ApplicationRow {
  id: string;
  person_id: string;
  committee_id: string | null;
  committee_name: string | null;
  role_slug: string | null;
  role_title: string | null;
  note: string;
  available_times: string;
  availability: string;
  state: ApplicationState;
  submitted_at: string;
  decided_at: string | null;
  decision_note: string;
  given_name: string | null;
  family_name: string | null;
  decided_by_given: string | null;
  decided_by_family: string | null;
}

const SELECT = `SELECT a.id,a.person_id,a.committee_id,c.name AS committee_name,a.role_slug,a.role_title,a.note,
  a.available_times,a.availability,a.state,a.submitted_at,a.decided_at,a.decision_note,p.given_name,p.family_name,
  d.given_name AS decided_by_given,d.family_name AS decided_by_family
  FROM committee_applications a
  JOIN people p ON p.id=a.person_id AND p.deleted_at IS NULL
  LEFT JOIN committees c ON c.id=a.committee_id
  LEFT JOIN people d ON d.id=a.decided_by`;

function memberView(row: ApplicationRow): MemberApplication {
  return {
    id: row.id,
    committeeId: row.committee_id,
    committeeName: row.committee_name,
    roleSlug: row.role_slug,
    roleTitle: row.role_title,
    state: row.state,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
  };
}
function staffView(row: ApplicationRow, now: Date): StaffApplication {
  const waitingDays = Math.max(
    0,
    Math.floor((now.getTime() - new Date(row.submitted_at).getTime()) / 86_400_000),
  );
  const decidedBy = [row.decided_by_given, row.decided_by_family].filter(Boolean).join(' ');
  return {
    ...memberView(row),
    personId: row.person_id,
    givenName: row.given_name,
    familyName: row.family_name,
    note: row.note,
    availableTimes: row.available_times.split(' ').filter(isAvailableTime),
    availability: row.availability,
    waitingDays,
    overdue: row.state === 'submitted' && waitingDays >= RESPONSE_DAYS,
    decidedByName: decidedBy || null,
  };
}

/** SQL limiting applications (alias `a`) to those the actor may decide, with its values. */
function staffScope(actor: Actor): { sql: string; values: SqlValue[] } {
  if (actor.membershipStatus !== 'member') return { sql: '0', values: [] };
  if (actor.staffAdmin) return { sql: '1', values: [] };
  return {
    sql: 'a.committee_id IN (SELECT value FROM json_each(?))',
    values: [JSON.stringify(leadCommitteeIds(actor))],
  };
}
/** Re-checked at write time from current records, not the request's actor snapshot. */
const DECIDER = `EXISTS (SELECT 1 FROM people s WHERE s.id=? AND s.deleted_at IS NULL AND s.membership_status='member' AND
  (EXISTS (SELECT 1 FROM staff_administrators WHERE person_id=s.id) OR
   EXISTS (SELECT 1 FROM committee_assignments l WHERE l.person_id=s.id AND l.committee_id=committee_applications.committee_id
     AND l.role='lead' AND l.ended_at IS NULL)))`;

export function validTarget(target: ApplicationTarget): boolean {
  if (target.roleSlug === null) return target.committeeId !== null && target.roleTitle === null;
  return (
    ROLE_SLUG.test(target.roleSlug) &&
    target.roleTitle !== null &&
    target.roleTitle.trim().length > 0 &&
    target.roleTitle.length <= 200
  );
}

export class CommitteeApplicationService {
  constructor(private readonly db: Db) {}

  /** Committees accepting members, for "Ask to join" and for checking a role's committee. */
  async openCommittees(): Promise<OpenCommittee[]> {
    const rows = await this.db
      .prepare(
        `SELECT id,name,description,time_commitment FROM committees WHERE taking_applications=1 AND accepting_members=1 ORDER BY name`,
      )
      .all<{ id: string; name: string; description: string; time_commitment: string }>();
    return rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      timeCommitment: row.time_commitment,
    }));
  }

  /** The committees a person is on now, for "You're on this team." */
  async memberCommittees(personId: string): Promise<Set<string>> {
    const rows = await this.db
      .prepare(
        `SELECT committee_id FROM committee_assignments WHERE person_id=? AND ended_at IS NULL`,
      )
      .bind(personId)
      .all<{ committee_id: string }>();
    return new Set(rows.results.map((row) => row.committee_id));
  }

  /**
   * Check the target committee. A posted role is its own opening, so it does not need the
   * committee to be taking applications, and a role naming a committee that does not exist is
   * left for the decider to place. Asking to join needs a committee open to applications.
   */
  private async placeTarget(
    personId: string,
    target: ApplicationTarget,
  ): Promise<ApplicationTarget | 'unavailable' | 'already_on_committee'> {
    if (target.committeeId === null) return target;
    const committee = await this.db
      .prepare(`SELECT accepting_members,taking_applications FROM committees WHERE id=?`)
      .bind(target.committeeId)
      .first<{ accepting_members: number; taking_applications: number }>();
    if (target.roleSlug !== null) return committee ? target : { ...target, committeeId: null };
    if (committee?.accepting_members !== 1 || committee.taking_applications !== 1)
      return 'unavailable';
    const current = await this.db
      .prepare(
        `SELECT 1 AS ok FROM committee_assignments WHERE person_id=? AND committee_id=? AND ended_at IS NULL`,
      )
      .bind(personId, target.committeeId)
      .first<{ ok: number }>();
    return current ? 'already_on_committee' : target;
  }

  async submit(
    personId: string,
    target: ApplicationTarget,
    input: { note: string; availableTimes?: readonly string[]; availability: string },
    now = new Date(),
  ): Promise<SubmitOutcome> {
    const note = input.note.trim();
    const availability = input.availability.trim();
    const chosen = input.availableTimes ?? [];
    if (
      !validTarget(target) ||
      note.length > NOTE_LIMIT ||
      availability.length > AVAILABILITY_LIMIT ||
      !chosen.every(isAvailableTime)
    )
      return { kind: 'invalid' };
    const availableTimes = AVAILABLE_TIMES.filter((time) => chosen.includes(time)).join(' ');
    const member = await this.db
      .prepare(
        `SELECT 1 AS ok FROM people WHERE id=? AND deleted_at IS NULL AND membership_status='member'`,
      )
      .bind(personId)
      .first<{ ok: number }>();
    if (!member) return { kind: 'unavailable' };
    const placed = await this.placeTarget(personId, target);
    if (typeof placed === 'string') return { kind: placed };
    target = placed;
    const id = ulid();
    const stamp = now.toISOString();
    // One open application per role, or per committee when no role was posted.
    const result = await this.db
      .prepare(
        `INSERT INTO committee_applications(id,person_id,committee_id,role_slug,role_title,note,available_times,availability,state,submitted_at,updated_at)
         SELECT ?,?,?,?,?,?,?,?,'submitted',?,? WHERE NOT EXISTS (
           SELECT 1 FROM committee_applications WHERE person_id=? AND state='submitted' AND
             ((? IS NOT NULL AND role_slug=?) OR (? IS NULL AND role_slug IS NULL AND committee_id=?)))`,
      )
      .bind(
        id,
        personId,
        target.committeeId,
        target.roleSlug,
        target.roleTitle,
        note,
        availableTimes,
        availability,
        stamp,
        stamp,
        personId,
        target.roleSlug,
        target.roleSlug,
        target.roleSlug,
        target.committeeId,
      )
      .run();
    return result.meta.changes > 0 ? { kind: 'ok', id } : { kind: 'duplicate' };
  }

  /** A member's own applications, newest first. */
  async forPerson(personId: string): Promise<MemberApplication[]> {
    const rows = await this.db
      .prepare(`${SELECT} WHERE a.person_id=? ORDER BY a.submitted_at DESC, a.id DESC LIMIT 50`)
      .bind(personId)
      .all<ApplicationRow>();
    return rows.results.map(memberView);
  }

  async withdraw(personId: string, id: string, now = new Date()): Promise<boolean> {
    const stamp = now.toISOString();
    const result = await this.db
      .prepare(
        `UPDATE committee_applications SET state='withdrawn',decided_at=?,updated_at=? WHERE id=? AND person_id=? AND state='submitted'`,
      )
      .bind(stamp, stamp, id, personId)
      .run();
    return result.meta.changes > 0;
  }

  /** Applications waiting for a decision, longest waiting first. */
  async queue(actor: Actor, now = new Date()): Promise<StaffApplication[]> {
    const scope = staffScope(actor);
    const rows = await this.db
      .prepare(
        `${SELECT} WHERE a.state='submitted' AND ${scope.sql} ORDER BY a.submitted_at, a.id LIMIT 100`,
      )
      .bind(...scope.values)
      .all<ApplicationRow>();
    return rows.results.map((row) => staffView(row, now));
  }

  /** Recently decided applications, newest first. */
  async decided(actor: Actor, now = new Date()): Promise<StaffApplication[]> {
    const scope = staffScope(actor);
    const rows = await this.db
      .prepare(
        `${SELECT} WHERE a.state IN ('accepted','declined') AND ${scope.sql} ORDER BY a.decided_at DESC, a.id DESC LIMIT 20`,
      )
      .bind(...scope.values)
      .all<ApplicationRow>();
    return rows.results.map((row) => staffView(row, now));
  }

  async entry(actor: Actor, id: string, now = new Date()): Promise<StaffApplication | null> {
    const scope = staffScope(actor);
    const row = await this.db
      .prepare(`${SELECT} WHERE a.id=? AND ${scope.sql}`)
      .bind(id, ...scope.values)
      .first<ApplicationRow>();
    return row ? staffView(row, now) : null;
  }

  /**
   * Accept: add the person to the committee as a member, then record the decision. Retrying
   * with the same operation ID is safe. If the person is already on the committee, the
   * application is accepted against that existing assignment.
   */
  async accept(
    actor: Actor,
    id: string,
    input: { committeeId: string; operationId: string; note: string },
    now = new Date(),
  ): Promise<DecisionOutcome> {
    const application = await this.entry(actor, id, now);
    if (!application) return { kind: 'not_found' };
    if (application.state !== 'submitted') return { kind: 'conflict' };
    const committeeId = input.committeeId || application.committeeId;
    const note = input.note.trim();
    if (!committeeId || !input.operationId || note.length > NOTE_LIMIT) return { kind: 'invalid' };
    const assigned = await new CommitteeService(this.db).assign({
      personId: application.personId,
      committeeId,
      role: 'member',
      actorId: actor.personId,
      operationId: input.operationId,
      reviewGuard: {
        sql: `EXISTS (SELECT 1 FROM committee_applications WHERE id=? AND person_id=? AND state='submitted')`,
        values: [id, application.personId],
      },
    });
    if (assigned.kind === 'forbidden') return { kind: 'forbidden' };
    if (assigned.kind === 'invalid') return { kind: 'invalid' };
    let assignmentId: string | null = assigned.kind === 'ok' ? assigned.value.id : null;
    if (!assignmentId) {
      const existing = await this.db
        .prepare(
          `SELECT id FROM committee_assignments WHERE person_id=? AND committee_id=? AND ended_at IS NULL`,
        )
        .bind(application.personId, committeeId)
        .first<{ id: string }>();
      if (!existing) return { kind: 'conflict' };
      assignmentId = existing.id;
    }
    const stamp = now.toISOString();
    const updated = await this.db
      .prepare(
        `UPDATE committee_applications SET state='accepted',committee_id=?,decided_at=?,decided_by=?,decision_note=?,
         assignment_id=?,updated_at=? WHERE id=? AND state='submitted'`,
      )
      .bind(committeeId, stamp, actor.personId, note, assignmentId, stamp, id)
      .run();
    return updated.meta.changes > 0 ? { kind: 'ok' } : { kind: 'conflict' };
  }

  async decline(
    actor: Actor,
    id: string,
    input: { operationId: string; note: string },
    now = new Date(),
  ): Promise<DecisionOutcome> {
    const application = await this.entry(actor, id, now);
    if (!application) return { kind: 'not_found' };
    const note = input.note.trim();
    if (!input.operationId || note.length > NOTE_LIMIT) return { kind: 'invalid' };
    const stamp = now.toISOString();
    const results = (await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
           SELECT ?,?,'committee_application.decline',?,?,?,? FROM committee_applications
           WHERE id=? AND state='submitted' AND ${DECIDER} ON CONFLICT DO NOTHING`,
        )
        .bind(
          ulid(),
          actor.personId,
          application.personId,
          JSON.stringify({ applicationId: id, committeeId: application.committeeId }),
          input.operationId,
          stamp,
          id,
          actor.personId,
        ),
      this.db
        .prepare(
          `UPDATE committee_applications SET state='declined',decided_at=?,decided_by=?,decision_note=?,updated_at=?
           WHERE id=? AND state='submitted' AND ${DECIDER}`,
        )
        .bind(stamp, actor.personId, note, stamp, id, actor.personId),
    ])) as ({ meta?: { changes?: number } } | undefined)[];
    if ((results[1]?.meta?.changes ?? 0) > 0) return { kind: 'ok' };
    const current = await this.entry(actor, id, now);
    if (current?.state === 'declined') return { kind: 'ok' };
    return current?.state === 'submitted' ? { kind: 'forbidden' } : { kind: 'conflict' };
  }
}
