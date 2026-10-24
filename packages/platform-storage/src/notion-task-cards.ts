import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';
import { TASK_CHECKIN_AUTHORITY_SQL as ELIGIBLE } from './notion-task-authority';

export interface TaskCardRecord {
  source_id: string;
  task_id: string;
  person_id: string;
  token: string;
  task_revision: string;
  consent_revision: number;
  policy_revision: number;
  channel_id: string | null;
  message_id: string | null;
  snoozed_until: string | null;
}
export interface TaskCardContext extends TaskCardRecord {
  retired: number;
  snapshot_json: string;
  policy_json: string;
  current_policy_revision: number;
  actionable: number;
}
/** Revision changes rotate the reference so an old modal cannot act on newer task state. */
export function ensureTaskCard(
  db: Db,
  input: { sourceId: string; taskId: string; personId: string },
  now: Date,
): Promise<TaskCardRecord | null> {
  return db
    .prepare(
      `WITH o AS (SELECT s.id AS source_id,t.task_id,c.person_id,t.revision AS task_revision,
    c.revision AS consent_revision,s.revision AS policy_revision FROM task_checkin_sources s
    JOIN task_checkin_tasks t ON t.source_id=s.id JOIN task_checkin_consents c ON c.source_id=s.id
    WHERE s.id=? AND t.task_id=? AND c.person_id=?)
    INSERT INTO task_checkin_cards(source_id,task_id,person_id,task_revision,consent_revision,policy_revision,token,updated_at)
    SELECT o.*,?,? FROM o WHERE ${ELIGIBLE}
    ON CONFLICT(source_id,task_id,person_id) DO UPDATE SET
    token=CASE WHEN task_checkin_cards.task_revision<>excluded.task_revision
      OR task_checkin_cards.consent_revision<>excluded.consent_revision
      OR task_checkin_cards.policy_revision<>excluded.policy_revision THEN excluded.token ELSE token END,
    task_revision=excluded.task_revision,consent_revision=excluded.consent_revision,
    policy_revision=excluded.policy_revision,updated_at=excluded.updated_at RETURNING *`,
    )
    .bind(input.sourceId, input.taskId, input.personId, randomToken(), now.toISOString())
    .first<TaskCardRecord>();
}
export function readTaskCard(
  db: Db,
  input: { token: string; discordUserId: string },
): Promise<TaskCardContext | null> {
  return db
    .prepare(
      `SELECT o.*,t.snapshot_json,s.policy_json,s.revision AS current_policy_revision,
    CASE WHEN o.retired=0 AND ${ELIGIBLE} THEN 1 ELSE 0 END AS actionable FROM (
      SELECT source_id,task_id,person_id,token,task_revision,consent_revision,policy_revision,
        channel_id,message_id,snoozed_until,0 AS retired FROM task_checkin_cards WHERE token=?
      UNION ALL
      SELECT source_id,task_id,person_id,token,task_revision,consent_revision,policy_revision,
        channel_id,message_id,snoozed_until,1 AS retired FROM task_checkin_retired_cards WHERE token=?
    ) o
    JOIN task_checkin_tasks t ON t.source_id=o.source_id AND t.task_id=o.task_id
    JOIN task_checkin_sources s ON s.id=o.source_id
    JOIN identities i ON i.person_id=o.person_id AND i.platform='discord'
      AND i.external_id=? AND i.link_method IN ('self_linked','staff_confirmed')
    JOIN people p ON p.id=o.person_id AND p.deleted_at IS NULL
    WHERE o.token=? AND (SELECT count(*) FROM identities j WHERE j.person_id=p.id AND j.platform='discord')=1
    AND NOT EXISTS(SELECT 1 FROM discord_disconnects d WHERE d.identity_record_id=i.id)`,
    )
    .bind(input.token, input.token, input.discordUserId, input.token)
    .first<TaskCardContext>();
}
export function taskCheckinActor(
  db: Db,
  discordUserId: string,
): Promise<{ person_id: string } | null> {
  return db
    .prepare(
      `SELECT i.person_id FROM identities i JOIN people p ON p.id=i.person_id
    WHERE i.platform='discord' AND i.external_id=? AND i.link_method IN ('self_linked','staff_confirmed')
    AND p.deleted_at IS NULL AND (SELECT count(*) FROM identities j WHERE j.person_id=p.id AND j.platform='discord')=1
    AND NOT EXISTS(SELECT 1 FROM discord_disconnects d WHERE d.identity_record_id=i.id)`,
    )
    .bind(discordUserId)
    .first<{ person_id: string }>();
}
export async function attachTaskCardMessage(
  db: Db,
  input: { token: string; channelId: string; messageId: string },
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE task_checkin_cards SET channel_id=?,message_id=?,updated_at=? WHERE token=?')
    .bind(input.channelId, input.messageId, now.toISOString(), input.token)
    .run();
  return result.meta.changes > 0;
}
export function readTaskInteractionReceipt(
  db: Db,
  input: { id: string; personId: string; sourceId: string; taskId: string },
) {
  return db
    .prepare(
      `SELECT state,kind,payload_json FROM task_checkin_operations
    WHERE id=? AND person_id=? AND source_id=? AND task_id=?`,
    )
    .bind(input.id, input.personId, input.sourceId, input.taskId)
    .first<{ state: string; kind: string; payload_json: string }>();
}
