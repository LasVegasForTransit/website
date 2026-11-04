import type { Db } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { auditedTaskCheckinChange } from './notion-task-admin-audit';
import { workScopeKey, type ProjectHome, type WorkConversation } from './discord-work-types';

/** Save a forum-specific event tag choice only against the approved current home. */
export async function setProjectEventForumTags(
  db: Db,
  actor: { personId: string },
  input: { home: ProjectHome; tagIds: string[] },
  now: Date,
): Promise<boolean> {
  const { home, tagIds } = input;
  if (
    home.state !== 'active' ||
    home.destination.kind !== 'forum' ||
    tagIds.length > 5 ||
    new Set(tagIds).size !== tagIds.length ||
    tagIds.some((id) => !/^\d{17,20}$/.test(id))
  )
    return false;
  const mutation = db
    .prepare(
      `UPDATE discord_project_homes SET data_json=json_set(data_json,'$.eventForumTags',json(?)),updated_at=?
    WHERE id=? AND scope_key=? AND state='active' AND generation=? AND destination_id=?
    AND json_extract(data_json,'$.audienceFingerprint')=?
    AND coalesce(json_extract(data_json,'$.eventForumTags'),'null')=? AND ${STAFF_ADMIN_SCOPE}`,
    )
    .bind(
      JSON.stringify({ forumId: home.destination.channelId, tagIds }),
      now.toISOString(),
      home.id,
      workScopeKey(home.scope),
      home.generation,
      home.destination.channelId,
      home.audienceFingerprint,
      JSON.stringify(home.eventForumTags ?? null),
      actor.personId,
    );
  return auditedTaskCheckinChange(db, actor, {
    mutation,
    action: 'discord_work.set_project_event_forum_tags',
    targetId: home.id,
    now,
  });
}
/** Record ownership after a provider update only while its operation and route are current. */
export async function commitManagedForumTags(
  db: Db,
  input: {
    conversation: WorkConversation;
    operationId: string;
    claimToken: string;
    routeId: string;
    routeRevision: number;
    previous: WorkConversation['managedForumTags'] | null;
    tagIds: string[];
  },
  now: Date,
): Promise<boolean> {
  const c = input.conversation;
  if (
    !input.routeId ||
    (input.previous && input.previous.routeId !== input.routeId) ||
    input.tagIds.length > 5 ||
    new Set(input.tagIds).size !== input.tagIds.length ||
    input.tagIds.some((id) => !/^\d{17,20}$/.test(id))
  )
    return false;
  const value = JSON.stringify({ routeId: input.routeId, tagIds: input.tagIds });
  const result = await db
    .prepare(
      `UPDATE discord_work_conversations SET data_json=json_set(data_json,'$.managedForumTags',json(?)),updated_at=?
    WHERE id=? AND scope_key=? AND generation=? AND state='active' AND thread_id=?
    AND coalesce(json_extract(data_json,'$.managedForumTags'),'null')=?
    AND EXISTS(SELECT 1 FROM discord_project_homes h WHERE h.id=discord_work_conversations.home_id AND h.scope_key=discord_work_conversations.scope_key AND h.state='active')
    AND EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.id=? AND o.scope_key=discord_work_conversations.scope_key AND o.conversation_id=discord_work_conversations.id AND o.generation=discord_work_conversations.generation AND o.kind='refresh' AND json_extract(o.payload_json,'$.intent')='tag-sync' AND json_extract(o.payload_json,'$.routeId')=? AND json_extract(o.payload_json,'$.routeRevision')=? AND o.state='processing' AND o.claim_token=? AND o.lease_expires_at>?)
    AND EXISTS(SELECT 1 FROM discord_work_routes r WHERE r.id=? AND r.scope_key=discord_work_conversations.scope_key AND r.state='active' AND r.revision=? AND json_extract(r.data_json,'$.tagSync') IS NOT NULL AND lower(replace(r.source_id,'-',''))=lower(replace(json_extract(discord_work_conversations.data_json,'$.subject.sourceId'),'-','')))`,
    )
    .bind(
      value,
      now.toISOString(),
      c.id,
      workScopeKey(c.scope),
      c.generation,
      c.threadId,
      JSON.stringify(input.previous),
      input.operationId,
      input.routeId,
      input.routeRevision,
      input.claimToken,
      now.toISOString(),
      input.routeId,
      input.routeRevision,
    )
    .run();
  return result.meta.changes > 0;
}
