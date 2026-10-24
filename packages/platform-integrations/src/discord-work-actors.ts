import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { STAFF_ADMIN_SCOPE } from '@lasvegasfortransit/platform-storage/staff-scope';
import { taskMappingMatches } from '@lasvegasfortransit/platform-storage/notion-task-person-lineage';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { WorkScope, WorkActor } from './discord-work-types';
export async function resolveWorkActors(
  db: Db,
  scope: WorkScope,
  userIds: string[],
): Promise<Map<string, WorkActor>> {
  const rows = await db
    .prepare(
      `SELECT p.id,trim(coalesce(p.given_name,'') || ' ' || coalesce(p.family_name,'')) AS display_name,i.id AS identity_id,i.external_id AS discord_user_id,i.updated_at,m.notion_user_id,m.version,
  (${STAFF_ADMIN_SCOPE.replace('?', 'p.id')}) AS administrator FROM identities i JOIN people p ON p.id=i.person_id
  LEFT JOIN task_checkin_mappings m ON m.workspace_id=? AND ${taskMappingMatches('m', 'p.id')}
  WHERE i.platform='discord' AND i.external_id IN (SELECT value FROM json_each(?)) AND i.link_method IN ('self_linked','staff_confirmed')
  AND p.deleted_at IS NULL AND p.erased_at IS NULL AND (SELECT count(*) FROM identities j WHERE j.person_id=p.id AND j.platform='discord')=1
  AND NOT EXISTS(SELECT 1 FROM discord_disconnects d WHERE d.identity_record_id=i.id)`,
    )
    .bind(scope.workspaceId, JSON.stringify([...new Set(userIds)].slice(0, 25)))
    .all<{
      id: string;
      display_name: string;
      identity_id: string;
      discord_user_id: string;
      updated_at: string;
      notion_user_id: string | null;
      version: string | null;
      administrator: number;
    }>();
  const actors = new Map<string, WorkActor>();
  for (const row of rows.results) {
    actors.set(row.discord_user_id, {
      personId: row.id,
      displayName: row.display_name || undefined,
      discordUserId: row.discord_user_id,
      notionUserIds: row.notion_user_id ? [row.notion_user_id] : [],
      administrator: Boolean(row.administrator),
      grantVersion: await digestToken(
        JSON.stringify([row.id, row.identity_id, row.updated_at, row.version, row.notion_user_id]),
      ),
    });
  }
  return actors;
}
