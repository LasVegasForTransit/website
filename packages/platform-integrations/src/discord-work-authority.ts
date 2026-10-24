import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { readTaskCheckinSource } from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { taskMappingMatches } from '@lasvegasfortransit/platform-storage/notion-task-person-lineage';
import {
  readProjectHome,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { STAFF_ADMIN_SCOPE } from '@lasvegasfortransit/platform-storage/staff-scope';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import { hydrateNotionTask } from './notion-task-hydrate';
import { parseNotionTaskPage } from './notion-task-reader';
import { readTaskCheckinPolicy } from './notion-task-policy';
import { notionObject, type NotionTaskSnapshot } from './notion-task-types';
import { readNotionProjectLeads } from './notion-task-projects';
import type { WorkAction, WorkActor, WorkScope, WorkSubject } from './discord-work-types';
export interface WorkAuthorityProviders {
  notion: NotionTaskClient;
  discord: { membership(userId: string, guildId: string): Promise<boolean> };
}
function uuid(value: string) {
  return value.replaceAll('-', '').toLowerCase();
}
export async function readWorkSource(db: Db, sourceId: string, scope: WorkScope) {
  const source = await readTaskCheckinSource(db, sourceId);
  const policy =
    source?.workspace_id === scope.workspaceId ? readTaskCheckinPolicy(source.policy_json) : null;
  return source && policy?.guildId === scope.guildId ? { source, policy } : null;
}
export async function readWorkTask(
  providers: WorkAuthorityProviders,
  source: NonNullable<Awaited<ReturnType<typeof readWorkSource>>>,
  subject: WorkSubject,
): Promise<NotionTaskSnapshot | null> {
  const options = { ...source.policy, sourceId: source.source.id };
  const hydrated = await hydrateNotionTask(
    providers.notion,
    await providers.notion.readPage(subject.pageId),
    options,
  );
  const task = parseNotionTaskPage(hydrated.page, hydrated.options);
  if (
    !task ||
    uuid(notionObject(hydrated.page).id as string) !== uuid(subject.pageId) ||
    ['source_mismatch', 'archived', 'trashed'].includes(task.snapshot.ineligibleReason ?? '')
  )
    return null;
  const raw = notionObject(hydrated.page);
  if (
    raw.archived === true ||
    raw.in_trash === true ||
    uuid(String(notionObject(raw.parent).data_source_id)) !== uuid(subject.sourceId)
  )
    return null;
  return task.snapshot;
}
export async function resolveWorkActor(
  db: Db,
  scope: WorkScope,
  discordUserId: string,
): Promise<WorkActor | null> {
  const rows = await db
    .prepare(
      `SELECT p.id,trim(coalesce(p.given_name,'') || ' ' || coalesce(p.family_name,'')) AS display_name,i.id AS identity_id,i.updated_at,m.notion_user_id,m.version FROM identities i JOIN people p ON p.id=i.person_id
 LEFT JOIN task_checkin_mappings m ON m.workspace_id=? AND ${taskMappingMatches('m', 'p.id')}
 WHERE i.platform='discord' AND i.external_id=? AND i.link_method IN ('self_linked','staff_confirmed') AND p.deleted_at IS NULL AND p.erased_at IS NULL
 AND (SELECT count(*) FROM identities j WHERE j.person_id=p.id AND j.platform='discord')=1
 AND NOT EXISTS(SELECT 1 FROM discord_disconnects d WHERE d.identity_record_id=i.id)`,
    )
    .bind(scope.workspaceId, discordUserId)
    .all<{
      id: string;
      display_name: string;
      identity_id: string;
      updated_at: string;
      notion_user_id: string | null;
      version: string | null;
    }>();
  const row = rows.results[0];
  if (!row || rows.results.length !== 1) return null;
  const administrator = Boolean(
    await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(row.id).first(),
  );
  return {
    personId: row.id,
    displayName: row.display_name || undefined,
    discordUserId,
    notionUserIds: row.notion_user_id ? [row.notion_user_id] : [],
    administrator,
    grantVersion: await digestToken(
      JSON.stringify([row.id, row.identity_id, row.updated_at, row.version, row.notion_user_id]),
    ),
  };
}
interface WorkAuthorizationInput {
  scope: WorkScope;
  subject: WorkSubject;
  discordUserId: string;
  action: WorkAction;
  taskSourceId?: string | undefined;
  homeId?: string | undefined;
  conversationId?: string | undefined;
  generation?: number | undefined;
}
type SourceContext = NonNullable<Awaited<ReturnType<typeof readWorkSource>>>;
async function authorizedHome(db: Db, input: WorkAuthorizationInput) {
  const home = input.homeId ? await readProjectHome(db, input.scope, input.homeId) : null;
  if (input.homeId && (!home || ['unlinked', 'paused'].includes(home.state)))
    return { valid: false, home: null };
  if (!input.conversationId)
    return {
      valid: !home || input.generation === undefined || home.generation === input.generation,
      home,
    };
  const conversation = await readWorkConversation(db, input.scope, input.conversationId);
  if (conversation?.state !== 'active') return { valid: false, home: null };
  if (input.generation !== undefined && conversation.generation !== input.generation)
    return { valid: false, home: null };
  if (JSON.stringify(conversation.subject) !== JSON.stringify(input.subject))
    return { valid: false, home: null };
  const owner = await readProjectHome(db, input.scope, conversation.homeId);
  return { valid: owner?.state === 'active', home: owner };
}
async function taskGrant(
  providers: WorkAuthorityProviders,
  source: SourceContext,
  actor: WorkActor,
  input: { request: WorkAuthorizationInput; home: Awaited<ReturnType<typeof readProjectHome>> },
): Promise<boolean> {
  const { request, home } = input;
  if (uuid(request.subject.sourceId) !== uuid(source.source.id)) return false;
  const task = await readWorkTask(providers, source, request.subject);
  if (!task) return false;
  if (home && !task.projectIds.includes(home.projectId)) return false;
  if (actor.administrator) return true;
  if (
    request.action !== 'place_work' &&
    task.assigneeIds.some((id) => actor.notionUserIds.includes(id))
  )
    return true;
  const projectIds = home ? [home.projectId] : task.projectIds;
  for (const projectId of projectIds) {
    const leads = await readNotionProjectLeads(
      providers.notion,
      projectId,
      source.policy.projectsSourceId,
      source.policy.projectLeadField,
    );
    if (leads?.some((id) => actor.notionUserIds.includes(id))) return true;
  }
  return false;
}
async function projectGrant(
  providers: WorkAuthorityProviders,
  source: SourceContext,
  actor: WorkActor,
  subject: WorkSubject,
) {
  if (
    subject.kind !== 'project_plan' ||
    uuid(subject.sourceId) !== uuid(source.policy.projectsSourceId)
  )
    return false;
  const leads = await readNotionProjectLeads(
    providers.notion,
    subject.pageId,
    subject.sourceId,
    source.policy.projectLeadField,
  );
  if (!leads) return false;
  return actor.administrator || leads.some((id) => actor.notionUserIds.includes(id));
}
function homeSourceMatches(
  home: Awaited<ReturnType<typeof readProjectHome>>,
  sourceId: string,
): boolean {
  return !home?.taskSourceId || uuid(home.taskSourceId) === uuid(sourceId);
}
export async function authorizeWork(
  db: Db,
  providers: WorkAuthorityProviders,
  input: WorkAuthorizationInput,
  _now: Date,
): Promise<WorkActor | null> {
  try {
    const actor = await resolveWorkActor(db, input.scope, input.discordUserId);
    if (!actor || !(await providers.discord.membership(input.discordUserId, input.scope.guildId)))
      return null;
    const binding = await authorizedHome(db, input);
    if (!binding.valid) return null;
    const sourceId =
      input.taskSourceId ?? (input.subject.kind === 'task' ? input.subject.sourceId : '');
    const source = await readWorkSource(db, sourceId, input.scope);
    if (!source || !homeSourceMatches(binding.home, sourceId)) return null;
    if (input.action === 'manage_home' && !actor.administrator) return null;
    const allowed =
      input.subject.kind === 'task'
        ? await taskGrant(providers, source, actor, { request: input, home: binding.home })
        : await projectGrant(providers, source, actor, input.subject);
    return allowed ? actor : null;
  } catch (error) {
    if (error instanceof NotionTaskApiError && !error.retryable) return null;
    throw error;
  }
}
