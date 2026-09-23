// The engagement log: everything a person did, as timestamped events that
// are only ever added, and the counts worked out from them. Features read
// these counts instead of keeping their own tallies. See person-service.md,
// "Engagement log".

import { nowIso, ulid } from '../core/ids';
import type { Db } from './db';

export const EVENT_TYPES = [
  'subscribed',
  'unsubscribed',
  'joined',
  'rsvp',
  'attended',
  'donated',
  'volunteer_shift',
  'role_changed',
  'check_in_held',
  'correction',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface EngagementInput {
  type: EventType;
  /** When it happened, which may be earlier than when it is recorded. */
  occurredAt: string;
  source: string;
  /**
   * The source's own ID for the event. The same person, type, source and
   * reference is recorded once. For a `correction`, the ID of the event it
   * marks as a mistake.
   */
  reference?: string;
  details?: Record<string, unknown>;
}

export async function recordEvent(
  db: Db,
  personId: string,
  input: EngagementInput,
): Promise<string> {
  if (!EVENT_TYPES.includes(input.type)) {
    throw new Error(`engagement log: unknown event type ${input.type as string}`);
  }
  const eventId = ulid();
  await db
    .prepare(
      `INSERT OR IGNORE INTO engagement_events (id, person_id, type, occurred_at, source, reference, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      eventId,
      personId,
      input.type,
      input.occurredAt,
      input.source,
      input.reference ?? null,
      input.details ? JSON.stringify(input.details) : null,
      nowIso(),
    )
    .run();
  if (!input.reference) return eventId;
  const row = await db
    .prepare(
      'SELECT id FROM engagement_events WHERE person_id = ? AND type = ? AND source = ? AND reference = ?',
    )
    .bind(personId, input.type, input.source, input.reference)
    .first<{ id: string }>();
  return row?.id ?? eventId;
}

export interface EngagementCounts {
  first_attended_at: string | null;
  last_attended_at: string | null;
  attended_last_90_days: number;
  attended_total: number;
  last_engaged_at: string | null;
  /** The start of the current unbroken newsletter subscription. */
  member_since: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The counts for one person, worked out from the log when asked. */
export async function engagementCounts(
  db: Db,
  personId: string,
  now: Date = new Date(),
): Promise<EngagementCounts> {
  const since = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const row = await db
    .prepare(
      `WITH counted AS (
         SELECT type, occurred_at FROM engagement_events
         WHERE person_id = ?1 AND type <> 'correction'
           AND id NOT IN (
             SELECT reference FROM engagement_events
             WHERE person_id = ?1 AND type = 'correction' AND reference IS NOT NULL
           )
       )
       SELECT
         min(CASE WHEN type = 'attended' THEN occurred_at END) AS first_attended_at,
         max(CASE WHEN type = 'attended' THEN occurred_at END) AS last_attended_at,
         coalesce(sum(type = 'attended' AND occurred_at >= ?2), 0) AS attended_last_90_days,
         coalesce(sum(type = 'attended'), 0) AS attended_total,
         max(occurred_at) AS last_engaged_at,
         (SELECT min(occurred_at) FROM counted WHERE type = 'subscribed'
            AND occurred_at > coalesce(
              (SELECT max(occurred_at) FROM counted WHERE type = 'unsubscribed'), '')
         ) AS member_since
       FROM counted`,
    )
    .bind(personId, since)
    .first<EngagementCounts>();
  return {
    first_attended_at: row?.first_attended_at ?? null,
    last_attended_at: row?.last_attended_at ?? null,
    attended_last_90_days: row?.attended_last_90_days ?? 0,
    attended_total: row?.attended_total ?? 0,
    last_engaged_at: row?.last_engaged_at ?? null,
    member_since: row?.member_since ?? null,
  };
}
