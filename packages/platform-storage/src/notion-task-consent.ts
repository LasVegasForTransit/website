import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';
import type { Db } from './db';

interface ConsentInput {
  sourceId: string;
  personId: string;
  discordUserId: string;
  interactionId: string;
  state: 'active' | 'paused' | 'opted_out';
  policyRevision: number;
}
/** Called only after signature verification of a volunteer's own Discord interaction. */
export async function setTaskCheckinConsent(
  db: Db,
  input: ConsentInput,
  now: Date,
): Promise<boolean> {
  // Signed Discord Snowflakes are monotonic decimal IDs; compare length then bytes,
  // avoiding SQLite's signed-integer limit and arrival-order races.
  if (!isDiscordId(input.interactionId)) return false;
  const result = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO task_checkin_consent_receipts
      (id,source_id,person_id,state,policy_revision,created_at)
      SELECT ?,s.id,p.id,?,?,? FROM task_checkin_sources s JOIN identities i
      ON i.platform='discord' AND i.external_id=? AND i.link_method IN ('self_linked','staff_confirmed')
      JOIN people p ON p.id=i.person_id AND p.deleted_at IS NULL
      WHERE s.id=? AND p.id=? AND (?<>'active' OR s.revision=?)
      AND (SELECT count(*) FROM identities j WHERE j.person_id=p.id AND j.platform='discord')=1
      AND NOT EXISTS(SELECT 1 FROM discord_disconnects d WHERE d.identity_record_id=i.id)`,
      )
      .bind(
        input.interactionId,
        input.state,
        input.policyRevision,
        now.toISOString(),
        input.discordUserId,
        input.sourceId,
        input.personId,
        input.state,
        input.policyRevision,
      ),
    db
      .prepare(
        `INSERT INTO task_checkin_consents
      (source_id,person_id,discord_user_id,state,policy_revision,interaction_id,updated_at,revision)
      SELECT source_id,person_id,?,state,policy_revision,id,?,1 FROM task_checkin_consent_receipts
      WHERE id=? AND applied=0
      ON CONFLICT(source_id,person_id) DO UPDATE SET discord_user_id=excluded.discord_user_id,
      state=excluded.state,policy_revision=excluded.policy_revision,interaction_id=excluded.interaction_id,
      updated_at=excluded.updated_at,revision=task_checkin_consents.revision+1
      WHERE length(excluded.interaction_id)>length(task_checkin_consents.interaction_id)
        OR (length(excluded.interaction_id)=length(task_checkin_consents.interaction_id)
          AND excluded.interaction_id>task_checkin_consents.interaction_id COLLATE BINARY)`,
      )
      .bind(input.discordUserId, now.toISOString(), input.interactionId),
    db
      .prepare(
        `UPDATE task_checkin_consent_receipts SET applied=1 WHERE id=? AND applied=0
        AND EXISTS(SELECT 1 FROM task_checkin_consents c WHERE c.interaction_id=task_checkin_consent_receipts.id
          AND c.source_id=task_checkin_consent_receipts.source_id AND c.person_id=task_checkin_consent_receipts.person_id)`,
      )
      .bind(input.interactionId),
  ]);
  const changed = result[1] as { meta: { changes: number } };
  return changed.meta.changes > 0;
}
export function readTaskCheckinConsent(
  db: Db,
  input: { sourceId: string; personId: string; discordUserId: string },
) {
  return db
    .prepare(
      `SELECT c.state,c.policy_revision,s.revision AS current_policy_revision FROM task_checkin_consents c
    JOIN task_checkin_sources s ON s.id=c.source_id
    JOIN people p ON p.id=c.person_id AND p.deleted_at IS NULL
    JOIN identities i ON i.person_id=p.id AND i.platform='discord' AND i.external_id=?
      AND i.link_method IN ('self_linked','staff_confirmed')
    WHERE c.source_id=? AND c.person_id=?
    AND NOT EXISTS(SELECT 1 FROM discord_disconnects d WHERE d.identity_record_id=i.id)
    AND (SELECT count(*) FROM identities j WHERE j.person_id=p.id AND j.platform='discord')=1`,
    )
    .bind(input.discordUserId, input.sourceId, input.personId)
    .first<{
      state: 'active' | 'paused' | 'opted_out';
      policy_revision: number;
      current_policy_revision: number;
    }>();
}
