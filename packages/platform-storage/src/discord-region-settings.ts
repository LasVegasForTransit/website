import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { isRegionId } from '@lasvegasfortransit/platform-core/regions';
import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';
import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';

export interface DiscordRegionSetting {
  id: string;
  name: string;
  roleId: string | null;
  settingsVersion: number;
}
export interface DiscordRegionSettingsInput {
  regionId: string;
  roleId: string | null;
  expectedVersion: number;
  operationId: string;
}
export const DISCORD_ROLE_REGISTRY = `SELECT 'committee:'||committee_id||':'||role_kind AS owner,external_id AS role_id FROM committee_account_mappings WHERE provider='discord'
  UNION SELECT 'committee:'||id||':member',discord_role_id FROM committees WHERE discord_role_id IS NOT NULL
  UNION SELECT 'committee:'||id||':lead',discord_lead_role_id FROM committees WHERE discord_lead_role_id IS NOT NULL
  UNION SELECT 'region:'||region_id,external_id FROM discord_region_role_mappings
  UNION SELECT 'region:'||id,discord_role_id FROM regions WHERE discord_role_id IS NOT NULL`;
export function normalizeDiscordRegionSettings(
  value: DiscordRegionSettingsInput,
): DiscordRegionSettingsInput | null {
  return isRegionId(value.regionId) &&
    (value.roleId === null || isDiscordId(value.roleId)) &&
    Number.isSafeInteger(value.expectedVersion) &&
    value.expectedVersion > 0 &&
    typeof value.operationId === 'string' &&
    value.operationId.length > 0 &&
    value.operationId.length <= 200
    ? value
    : null;
}
export async function listDiscordRegionSettings(
  db: Db,
  actorId: string,
): Promise<DiscordRegionSetting[]> {
  const { results } = await db
    .prepare(
      `SELECT id,name,discord_role_id AS roleId,settings_version AS settingsVersion FROM regions WHERE ${STAFF_ADMIN_SCOPE} ORDER BY sort_order`,
    )
    .bind(actorId)
    .all<DiscordRegionSetting>();
  return results;
}
/** Mapping, retired ownership, reconciliation and attribution commit together under current authority. */
export async function saveDiscordRegionSettings(
  db: Db,
  actor: Actor,
  requested: DiscordRegionSettingsInput,
): Promise<MutationResult<DiscordRegionSetting>> {
  if (!(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first()))
    return { kind: 'forbidden' };
  const input = normalizeDiscordRegionSettings(requested);
  if (!input) return { kind: 'invalid' };
  const payload = JSON.stringify(input),
    stamp = new Date().toISOString();
  const fresh = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND kind='discord.region.settings' AND target_id=? AND payload=? AND applied_at IS NULL) AND ${STAFF_ADMIN_SCOPE}`;
  const values = [input.operationId, actor.personId, input.regionId, payload, actor.personId];
  const state = `json_object('id',id,'name',name,'roleId',discord_role_id,'settingsVersion',settings_version)`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at,before_state)
      SELECT ?,?,'discord.region.settings',?,?,?,${state} FROM regions WHERE id=? AND settings_version=? AND ${STAFF_ADMIN_SCOPE}
      AND NOT EXISTS(SELECT 1 FROM (${DISCORD_ROLE_REGISTRY}) registered WHERE role_id=? AND owner<>?) ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        input.operationId,
        actor.personId,
        input.regionId,
        payload,
        stamp,
        input.regionId,
        input.expectedVersion,
        actor.personId,
        input.roleId,
        `region:${input.regionId}`,
      ),
    db
      .prepare(
        `UPDATE regions SET discord_role_id=?,settings_version=settings_version+1,updated_at=? WHERE id=? AND settings_version=? AND ${fresh}`,
      )
      .bind(input.roleId, stamp, input.regionId, input.expectedVersion, ...values),
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT ?,?,'discord.region.settings',?,?,?,? WHERE ${fresh}`,
      )
      .bind(ulid(), actor.personId, input.regionId, payload, input.operationId, stamp, ...values),
    db
      .prepare(
        `UPDATE staff_operations SET result=(SELECT ${state} FROM regions WHERE id=?),applied_at=? WHERE operation_id=? AND ${fresh}`,
      )
      .bind(input.regionId, stamp, input.operationId, ...values),
  ]);
  const receipt = await db
    .prepare(
      `SELECT result FROM staff_operations WHERE operation_id=? AND actor_id=? AND kind='discord.region.settings' AND target_id=? AND payload=? AND applied_at IS NOT NULL AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(...values)
    .first<{ result: string }>();
  return receipt
    ? { kind: 'ok', value: JSON.parse(receipt.result) as DiscordRegionSetting }
    : { kind: 'conflict' };
}
