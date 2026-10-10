import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, Statement } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import type { CommitteeSettingsInput } from './committee-settings-input';
export interface SettingsMutation extends CommitteeSettingsInput {
  actorId: string;
  committeeId: string;
  payload: string;
  stamp: string;
}
const FRESH = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND kind='committee.settings' AND target_id=? AND payload=? AND applied_at IS NULL)`;
const AUTHORIZED = `${FRESH} AND ${STAFF_ADMIN_SCOPE}`;
const MAPPING_CHANGED = `EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND
 (json_extract(before_state,'$.workspaceGroupEmail') IS NOT ? OR json_extract(before_state,'$.discordRoleId') IS NOT ?))`;
const SETTINGS_JSON = `json_object('id',c.id,'name',c.name,'description',c.description,'timeCommitment',c.time_commitment,
 'acceptingMembers',json(CASE WHEN c.accepting_members=1 THEN 'true' ELSE 'false' END),'settingsVersion',c.settings_version,
 'workspaceGroupEmail',c.workspace_group_email,'discordRoleId',c.discord_role_id,'interestIds',json(c.interest_ids))`;
function fresh(input: SettingsMutation) {
  return [input.operationId, input.actorId, input.committeeId, input.payload];
}
function authorized(input: SettingsMutation) {
  return [...fresh(input), input.actorId];
}
function changed(input: SettingsMutation) {
  return [input.operationId, input.workspaceGroupEmail, input.discordRoleId];
}
function insertReceipt(db: Db, input: SettingsMutation): Statement {
  return db
    .prepare(
      `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at,before_state)
    SELECT ?,?,'committee.settings',?,?,?,${SETTINGS_JSON} FROM committees c WHERE c.id=? AND c.settings_version=? AND ${STAFF_ADMIN_SCOPE}
    AND NOT EXISTS(SELECT 1 FROM committee_account_mappings m WHERE m.committee_id<>c.id AND ((m.provider='google_workspace' AND m.external_id=?) OR (m.provider='discord' AND m.external_id=?)))
    ON CONFLICT(operation_id) DO NOTHING`,
    )
    .bind(
      input.operationId,
      input.actorId,
      input.committeeId,
      input.payload,
      input.stamp,
      input.committeeId,
      input.expectedVersion,
      input.actorId,
      input.workspaceGroupEmail,
      input.discordRoleId,
    );
}
function mappings(db: Db, input: SettingsMutation): Statement[] {
  return [
    db
      .prepare(
        `INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at)
      SELECT c.id,'google_workspace',lower(c.workspace_group_email),? FROM committees c WHERE c.id=? AND c.workspace_group_email IS NOT NULL AND ${AUTHORIZED} ON CONFLICT DO NOTHING`,
      )
      .bind(input.stamp, input.committeeId, ...authorized(input)),
    db
      .prepare(
        `INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at)
      SELECT c.id,'discord',c.discord_role_id,? FROM committees c WHERE c.id=? AND c.discord_role_id IS NOT NULL AND ${AUTHORIZED} ON CONFLICT DO NOTHING`,
      )
      .bind(input.stamp, input.committeeId, ...authorized(input)),
    ...[
      { provider: 'google_workspace', id: input.workspaceGroupEmail },
      { provider: 'discord', id: input.discordRoleId },
    ]
      .filter((mapping) => mapping.id !== null)
      .map((mapping) =>
        db
          .prepare(
            `INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at) SELECT ?,?,?,? WHERE ${AUTHORIZED} ON CONFLICT DO NOTHING`,
          )
          .bind(input.committeeId, mapping.provider, mapping.id, input.stamp, ...authorized(input)),
      ),
  ];
}
function saveSettings(db: Db, input: SettingsMutation): Statement {
  return db
    .prepare(
      `UPDATE committees SET description=?,time_commitment=?,accepting_members=?,workspace_group_email=?,discord_role_id=?,interest_ids=?,settings_version=settings_version+1,updated_at=?
    WHERE id=? AND settings_version=? AND ${AUTHORIZED}`,
    )
    .bind(
      input.description,
      input.timeCommitment,
      Number(input.acceptingMembers),
      input.workspaceGroupEmail,
      input.discordRoleId,
      JSON.stringify(input.interestIds),
      input.stamp,
      input.committeeId,
      input.expectedVersion,
      ...authorized(input),
    );
}
function reconcileWrites(db: Db, input: SettingsMutation): Statement[] {
  return [
    db
      .prepare(
        `INSERT INTO reconcile_generations(person_id,target_id,generation)
      SELECT DISTINCT a.person_id,a.committee_id,1 FROM committee_assignments a JOIN people p ON p.id=a.person_id AND p.deleted_at IS NULL
      WHERE a.committee_id=? AND ${AUTHORIZED} AND ${MAPPING_CHANGED} ON CONFLICT(person_id,target_id) DO UPDATE SET generation=generation+1`,
      )
      .bind(input.committeeId, ...authorized(input), ...changed(input)),
    db
      .prepare(
        `UPDATE integration_outbox SET state='superseded',updated_at=? WHERE target_id=? AND state IN ('queued','running','retry')
      AND generation<>(SELECT g.generation FROM reconcile_generations g WHERE g.person_id=integration_outbox.person_id AND g.target_id=integration_outbox.target_id) AND ${AUTHORIZED} AND ${MAPPING_CHANGED}`,
      )
      .bind(input.stamp, input.committeeId, ...authorized(input), ...changed(input)),
    db
      .prepare(
        `INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      SELECT ?||':'||g.person_id,'committee_reconcile',g.person_id,g.target_id,g.generation,?,?,?,?
      FROM reconcile_generations g JOIN people p ON p.id=g.person_id AND p.deleted_at IS NULL WHERE g.target_id=? AND EXISTS(SELECT 1 FROM committee_assignments a WHERE a.person_id=g.person_id AND a.committee_id=g.target_id)
      AND ${AUTHORIZED} AND ${MAPPING_CHANGED}`,
      )
      .bind(
        input.operationId,
        JSON.stringify({ action: 'settings_changed', committeeId: input.committeeId }),
        input.stamp,
        input.stamp,
        input.stamp,
        input.committeeId,
        ...authorized(input),
        ...changed(input),
      ),
  ];
}
function finish(db: Db, input: SettingsMutation): Statement[] {
  return [
    db
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at)
      SELECT ?,?,'committee.settings',?,json_object('before',json(o.before_state),'after',${SETTINGS_JSON}),?,?
      FROM staff_operations o JOIN committees c ON c.id=o.target_id WHERE o.operation_id=? AND c.settings_version=? AND ${AUTHORIZED}`,
      )
      .bind(
        ulid(),
        input.actorId,
        input.committeeId,
        input.operationId,
        input.stamp,
        input.operationId,
        input.expectedVersion + 1,
        ...authorized(input),
      ),
    db
      .prepare(
        `UPDATE staff_operations SET applied_at=?,result=(SELECT ${SETTINGS_JSON} FROM committees c WHERE c.id=?)
      WHERE operation_id=? AND ${AUTHORIZED} AND EXISTS(SELECT 1 FROM staff_audits WHERE operation_id=? AND action='committee.settings')`,
      )
      .bind(
        input.stamp,
        input.committeeId,
        input.operationId,
        ...authorized(input),
        input.operationId,
      ),
  ];
}
export function settingsWrites(db: Db, input: SettingsMutation): Statement[] {
  return [
    insertReceipt(db, input),
    ...mappings(db, input),
    saveSettings(db, input),
    ...reconcileWrites(db, input),
    ...finish(db, input),
  ];
}
