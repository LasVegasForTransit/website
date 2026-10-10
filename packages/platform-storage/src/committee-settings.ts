import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import { can } from '@lasvegasfortransit/platform-core/permissions';
import type { Db } from './db';
import { loadActor } from './staff-roles';
import { auditDenied } from './audits';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { normalizeSettings, type CommitteeSettingsInput } from './committee-settings-input';
import type { CommitteeSettings } from './committee-views';
import { settingsWrites } from './committee-settings-writes';
export type { CommitteeSettingsInput } from './committee-settings-input';
export async function updateCommitteeSettings(
  db: Db,
  actor: Actor,
  committeeId: string,
  requested: CommitteeSettingsInput,
): Promise<MutationResult<CommitteeSettings>> {
  const current = await loadActor(db, actor.personId);
  if (!current || !can(current, 'committee.settings')) {
    await auditDenied(db, actor.personId, 'committee.settings');
    return { kind: 'forbidden' };
  }
  const input = normalizeSettings(requested);
  if (!input) return { kind: 'invalid' };
  const { operationId, ...data } = input;
  const payload = JSON.stringify(data);
  await db.batch(
    settingsWrites(db, {
      ...input,
      actorId: actor.personId,
      committeeId,
      payload,
      stamp: new Date().toISOString(),
    }),
  );
  const receipt = await db
    .prepare(
      `SELECT result FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND kind='committee.settings' AND payload=? AND applied_at IS NOT NULL AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(operationId, actor.personId, committeeId, payload, actor.personId)
    .first<{ result: string }>();
  return receipt
    ? { kind: 'ok', value: JSON.parse(receipt.result) as CommitteeSettings }
    : { kind: 'conflict' };
}
