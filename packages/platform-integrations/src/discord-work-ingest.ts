import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readWorkConversation,
  readProjectHome,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { acceptWorkMessages } from '@lasvegasfortransit/platform-storage/discord-work-ingress';
import { resolveWorkActors } from './discord-work-actors';
import { readWorkSource, readWorkTask } from './discord-work-authority';
import { readNotionProjectLeads } from './notion-task-projects';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type {
  WorkConversation,
  WorkMessage,
  WorkResult,
  WorkOperationInput,
  WorkActor,
} from './discord-work-types';
export function workMessageKey(pageId: string, m: { channelId: string; id: string }): string {
  return `comment:${pageId}:${m.channelId}:${m.id}`;
}
function human(m: WorkMessage) {
  return !m.bot && !m.webhook && !m.system;
}
async function eligibleActors(
  db: Db,
  providers: WorkProviders,
  input: { conversation: WorkConversation; messages: WorkMessage[]; taskSourceId: string },
): Promise<Map<string, WorkActor> | null> {
  const { conversation: c, messages } = input;
  const actors = await resolveWorkActors(
    db,
    c.scope,
    messages.filter(human).map((m) => m.authorId),
  );
  const source = await readWorkSource(db, input.taskSourceId, c.scope);
  if (!source) return null;
  const task = await readWorkTask(providers, source, c.subject);
  if (!task?.projectIds.includes(c.placementProjectId)) return null;
  const leads = await readNotionProjectLeads(
    providers.notion,
    c.placementProjectId,
    source.policy.projectsSourceId,
    source.policy.projectLeadField,
  );
  if (!leads) return null;
  const eligibleIds = new Set([...task.assigneeIds, ...leads]);
  return new Map(
    [...actors].filter(
      ([, a]) => a.administrator || a.notionUserIds.some((id) => eligibleIds.has(id)),
    ),
  );
}
function windowStep(c: WorkConversation, messages: WorkMessage[]): WorkConversation {
  const sorted = [...messages].sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1));
  const upper = c.windowUpperId ?? sorted[0]?.id ?? c.cursorId;
  const before = sorted[sorted.length - 1]?.id ?? c.cursorId;
  const complete = messages.length < 25 || BigInt(before) <= BigInt(c.cursorId);
  return {
    ...c,
    cursorId: complete ? upper : c.cursorId,
    windowUpperId: complete ? null : upper,
    windowBeforeId: complete ? null : before,
  };
}
function messageOperation(
  c: WorkConversation,
  m: WorkMessage,
  actor: WorkActor,
): WorkOperationInput {
  return {
    id: crypto.randomUUID(),
    scope: c.scope,
    homeId: c.homeId,
    conversationId: c.id,
    generation: c.generation,
    kind: 'comment',
    sourceKey: workMessageKey(c.subject.pageId, m),
    actorPersonId: actor.personId,
    actorDiscordId: actor.discordUserId,
    grantVersion: actor.grantVersion,
    originalAuthorId: m.authorId,
    payload: { message: m, automatic: true, taskSourceId: c.subject.sourceId },
  };
}
async function readPermittedWindow(
  db: Db,
  providers: WorkProviders,
  c: WorkConversation,
): Promise<WorkMessage[] | null> {
  const home = await readProjectHome(db, c.scope, c.homeId);
  if (home?.state !== 'active') return null;
  const placement = await providers.discord.inspectDestination(home.destination.channelId);
  const thread = await providers.discord.inspectDestination(c.threadId);
  if (
    !thread.canRead ||
    thread.locked ||
    placement.audienceFingerprint !== home.audienceFingerprint
  )
    return null;
  if (!(await providers.discord.messageContentAvailable())) return null;
  return providers.discord.readMessages(
    c.threadId,
    c.windowBeforeId ? { before: c.windowBeforeId, limit: 25 } : { after: c.cursorId, limit: 25 },
  );
}
export async function ingestWorkConversation(
  db: Db,
  providers: WorkProviders,
  conversationId: string,
  context: WorkEffectContext,
): Promise<WorkResult> {
  if (!context.enabled) return { kind: 'idle' };
  const c = await readWorkConversation(db, context.scope, conversationId);
  if (c?.state !== 'active' || c.mode !== 'automatic' || c.subject.kind !== 'task')
    return { kind: 'idle' };
  const messages = await readPermittedWindow(db, providers, c);
  if (!messages) return { kind: 'paused', reason: 'content_or_destination_unavailable' };
  const upper = c.windowUpperId;
  const fresh = messages.filter(
    (m) =>
      BigInt(m.id) > BigInt(c.cursorId) &&
      BigInt(m.id) > BigInt(c.activationId) &&
      (!upper || BigInt(m.id) <= BigInt(upper)),
  );
  if (fresh.some((m) => human(m) && (!m.contentAvailable || (!m.text && !m.attachmentOnly))))
    return { kind: 'paused', reason: 'message_content_unavailable' };
  const actors = await eligibleActors(db, providers, {
    conversation: c,
    messages: fresh,
    taskSourceId: context.taskSourceId,
  });
  if (!actors) return { kind: 'paused', reason: 'source_unavailable' };
  const operations = fresh.flatMap((m) => {
    const actor = actors.get(m.authorId);
    return actor && human(m) && m.text.trim() ? [messageOperation(c, m, actor)] : [];
  });
  const result = await acceptWorkMessages(
    db,
    { previous: c, next: windowStep(c, messages), operations },
    context.clock(),
  );
  return { kind: result === 'accepted' ? 'progress' : 'idle' };
}
