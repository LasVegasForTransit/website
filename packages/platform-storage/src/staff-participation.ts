import type { Db } from './db';
import { COUNTED_ENGAGEMENT } from './engagement';
import { STAFF_PERSON_SCOPE } from './staff-scope';

export interface StaffParticipation {
  attendedTotal: number;
  rsvpTotal: number;
  items: {
    id: string;
    type: 'attended' | 'rsvp';
    occurredAt: string;
    eventName: string | null;
  }[];
}

/** Read participation independently of the mixed history page, under current person.view scope. */
export async function staffParticipation(
  db: Db,
  actorId: string,
  personId: string,
): Promise<StaffParticipation | null> {
  const scope = `p.id=?1 AND p.deleted_at IS NULL AND ${STAFF_PERSON_SCOPE.replaceAll('?', '?2')}`;
  const { results } = await db
    .prepare(
      `
    WITH participation AS (
      SELECT e.id,e.type,e.occurred_at,
        CASE WHEN json_type(e.details,'$.eventName')='text'
          THEN nullif(substr(trim(json_extract(e.details,'$.eventName')),1,160),'')
          ELSE NULL END AS event_name
      FROM people p JOIN engagement_events e ON e.person_id=p.id
      WHERE ${scope} AND e.type IN ('attended','rsvp') AND ${COUNTED_ENGAGEMENT}
    )
    SELECT recent.*,
      (SELECT count(*) FROM participation WHERE type='attended') AS attended_total,
      (SELECT count(*) FROM participation WHERE type='rsvp') AS rsvp_total
    FROM people p LEFT JOIN (
      SELECT * FROM participation ORDER BY occurred_at DESC,id DESC LIMIT 10
    ) recent ON 1=1
    WHERE ${scope} ORDER BY recent.occurred_at DESC,recent.id DESC
  `,
    )
    .bind(personId, actorId)
    .all<{
      id: string | null;
      type: 'attended' | 'rsvp';
      occurred_at: string;
      event_name: string | null;
      attended_total: number;
      rsvp_total: number;
    }>();
  const first = results[0];
  if (!first) return null;
  return {
    attendedTotal: first.attended_total,
    rsvpTotal: first.rsvp_total,
    items: results.flatMap((row) =>
      row.id
        ? [
            {
              id: row.id,
              type: row.type,
              occurredAt: row.occurred_at,
              eventName: row.event_name,
            },
          ]
        : [],
    ),
  };
}
