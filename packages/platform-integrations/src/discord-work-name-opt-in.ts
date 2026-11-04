import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  listProjectHomesAtDestination,
  listWorkConversations,
  listWorkConversationsAtThread,
  readProjectHome,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  workScopeKey,
  type ProjectHome,
  type WorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-types';
import { authorizeWork } from './discord-work-authority';
import {
  currentWorkAudience,
  type WorkEffectContext,
  type WorkProviders,
} from './discord-work-actions';
import { notionWorkUrl } from './discord-work-input';
import { setupReply } from './discord-work-setup-common';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

async function findTarget(
  db: Db,
  input: WorkPreviewInput,
  context: WorkEffectContext,
  pageId: string | undefined,
) {
  const threads = (
    await listWorkConversationsAtThread(db, context.scope, input.channelId, pageId)
  ).filter((c) => c.state === 'active' && ['project_plan', 'event_plan'].includes(c.subject.kind));
  const homes = (
    await listProjectHomesAtDestination(db, context.scope, input.channelId, pageId)
  ).filter((h) => h.state === 'active' && h.kind !== 'event' && h.destination.kind === 'forum');
  if (threads.length + homes.length !== 1) return null;
  if (threads[0]) {
    const home = await readProjectHome(db, context.scope, threads[0].homeId);
    return home ? { home, c: threads[0], target: 'thread' as const } : null;
  }
  const home = homes[0];
  if (!home) return null;
  const conversations = await listWorkConversations(db, context.scope, home.id);
  const overview = conversations.find(
    (c) => c.state === 'active' && c.subject.kind === 'project_plan',
  );
  return overview ? { home, c: overview, target: 'forum' as const } : null;
}

async function permitted(
  db: Db,
  providers: WorkProviders,
  {
    input,
    context,
    link,
  }: {
    input: WorkPreviewInput;
    context: WorkEffectContext;
    link: { home: ProjectHome; c: WorkConversation };
  },
) {
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject: link.c.subject,
      taskSourceId: context.taskSourceId,
      homeId: link.home.id,
      conversationId: link.c.id,
      generation: link.c.generation,
      discordUserId: input.discordUserId,
      action: 'manage_home',
    },
    context.clock(),
  );
  return actor && (await currentWorkAudience(db, providers, link.c)) ? actor : null;
}

export async function enableNameSync(
  db: Db,
  providers: WorkProviders,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkPreviewResult> {
  if (!context.enabled)
    return setupReply('Name sync is unavailable while the integration is disabled.');
  const pageId = input.intent.url ? notionWorkUrl(input.intent.url) : undefined;
  if (input.intent.url && !pageId) return setupReply('Provide a valid Notion page URL.');
  const link = await findTarget(db, input, context, pageId ?? undefined);
  if (!link)
    return setupReply('Choose one linked forum or post and check your administrator access.');
  const actor = await permitted(db, providers, { input, context, link });
  if (!actor)
    return setupReply('Choose one linked forum or post and check your administrator access.');
  const name = await providers.discord.readPlanningName(input.channelId);
  const current = await permitted(db, providers, { input, context, link });
  if (current?.personId !== actor.personId || current.grantVersion !== actor.grantVersion)
    return setupReply('Access changed. Try again.');
  const resolve = input.intent.action === 'resolve-name';
  const saved = await saveNameOptIn(db, context, link, { name, actor, resolve });
  return setupReply(
    saved
      ? resolve
        ? 'Held update resolved. Name sync will follow the linked Notion page.'
        : 'Name sync enabled. The name will follow the linked Notion page.'
      : 'The link changed, another link manages this name, or an update needs review. Use /work show.',
  );
}

async function saveNameOptIn(
  db: Db,
  context: WorkEffectContext,
  link: NonNullable<Awaited<ReturnType<typeof findTarget>>>,
  {
    name,
    actor,
    resolve,
  }: { name: string; actor: NonNullable<Awaited<ReturnType<typeof permitted>>>; resolve: boolean },
): Promise<boolean> {
  const isForum = link.target === 'forum';
  const table = isForum ? 'discord_project_homes' : 'discord_work_conversations';
  const id = isForum ? link.home.id : link.c.id;
  const generation = isForum ? link.home.generation : link.c.generation;
  const previous = isForum ? link.home.managedName : link.c.managedName;
  const revision = isForum ? link.home.nameSyncRevision : link.c.nameSyncRevision;
  const column = isForum ? 'destination_id' : 'thread_id';
  const channelId = isForum ? link.home.destination.channelId : link.c.threadId;
  const nextRevision = crypto.randomUUID();
  const save = db
    .prepare(
      `UPDATE ${table} SET data_json=json_set(data_json,'$.managedName',?,'$.managedNameReason',NULL,'$.nameSyncRevision',?,'$.managedNameAuthority',json(?)),updated_at=? WHERE id=? AND scope_key=? AND generation=? AND state='active' AND json_extract(data_json,'$.managedName') IS ? AND json_extract(data_json,'$.nameSyncRevision') IS ? AND NOT EXISTS(SELECT 1 FROM ${table} other WHERE other.scope_key=${table}.scope_key AND other.id<>${table}.id AND other.state='active' AND other.${column}=${table}.${column} AND json_extract(other.data_json,'$.managedName') IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM discord_work_operations o JOIN discord_work_conversations c ON c.id=o.conversation_id AND c.scope_key=o.scope_key JOIN discord_project_homes h ON h.id=c.home_id AND h.scope_key=c.scope_key WHERE o.scope_key=${table}.scope_key AND o.kind='refresh' AND o.state IN ('processing','held') AND json_extract(o.payload_json,'$.intent')='name-sync' AND json_extract(o.payload_json,'$.target')=? AND (CASE WHEN ?='forum' THEN h.destination_id ELSE c.thread_id END)=? AND (o.state='processing' OR ?=0 OR o.conversation_id<>?)) AND (?=0 OR EXISTS(SELECT 1 FROM discord_work_operations held WHERE held.scope_key=${table}.scope_key AND held.conversation_id=? AND held.state='held' AND held.updated_at<=? AND held.kind='refresh' AND json_extract(held.payload_json,'$.intent')='name-sync' AND json_extract(held.payload_json,'$.target')=?))`,
    )
    .bind(
      name,
      nextRevision,
      JSON.stringify({
        actor_person_id: actor.personId,
        actor_discord_id: actor.discordUserId,
        grant_version: actor.grantVersion,
      }),
      context.clock().toISOString(),
      id,
      workScopeKey(context.scope),
      generation,
      previous ?? null,
      revision ?? null,
      link.target,
      link.target,
      channelId,
      Number(resolve),
      link.c.id,
      Number(resolve),
      link.c.id,
      new Date(context.clock().getTime() - 15_000).toISOString(),
      link.target,
    );
  if (!resolve) return (await save.run()).meta.changes > 0;
  const scope = workScopeKey(context.scope);
  const reviewed = db
    .prepare(
      `UPDATE discord_work_operations SET state='superseded',reason='reviewed_name_resolution',updated_at=? WHERE scope_key=? AND conversation_id=? AND kind='refresh' AND state='held' AND json_extract(payload_json,'$.intent')='name-sync' AND json_extract(payload_json,'$.target')=? AND EXISTS(SELECT 1 FROM ${table} t WHERE t.id=? AND t.scope_key=discord_work_operations.scope_key AND json_extract(t.data_json,'$.nameSyncRevision')=?)`,
    )
    .bind(context.clock().toISOString(), scope, link.c.id, link.target, id, nextRevision);
  const stale = db
    .prepare(
      `UPDATE discord_work_operations SET state='superseded',reason='reviewed_name_resolution',updated_at=? WHERE scope_key=? AND conversation_id=? AND kind='refresh' AND state IN ('queued','retryable') AND json_extract(payload_json,'$.intent')='name-sync' AND json_extract(payload_json,'$.target')=? AND EXISTS(SELECT 1 FROM ${table} t WHERE t.id=? AND t.scope_key=discord_work_operations.scope_key AND json_extract(t.data_json,'$.nameSyncRevision')=?)`,
    )
    .bind(context.clock().toISOString(), scope, link.c.id, link.target, id, nextRevision);
  const results = await db.batch([save, reviewed, stale]);
  return ((results[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) > 0;
}
