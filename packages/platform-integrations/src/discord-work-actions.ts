import { workSubject, workString } from './discord-work-input';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readProjectHome,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { settleWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import type {
  WorkOperation,
  WorkOutcome,
} from '@lasvegasfortransit/platform-storage/discord-work-types';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import { DiscordApiFailure, discordId } from './discord-types';
import { authorizeWork, readWorkSource, readWorkTask } from './discord-work-authority';
import { sharedTaskCard } from './discord-work-cards';
import { taskStatus } from './notion-task-status';
import { notionObject, notionProperty } from './notion-task-types';
import { ensureNotionWorkLink } from './notion-work-links';
import type { DiscordWorkClient } from './discord-work-provider';
import type {
  WorkScope,
  WorkMessage,
  WorkActor,
  WorkResult,
  WorkConversation,
} from './discord-work-types';
export interface WorkProviders {
  notion: NotionTaskClient;
  discord: DiscordWorkClient;
}
export interface WorkEffectContext {
  scope: WorkScope;
  taskSourceId: string;
  enabled: boolean;
  clock: () => Date;
}
function marker(pageId: string, operationId: string) {
  return `https://www.notion.so/${pageId.replaceAll('-', '')}?lvbt_work_update=${encodeURIComponent(operationId)}`;
}
export function workComment(input: {
  message: WorkMessage;
  actor: WorkActor;
  submittedBy?: WorkActor | undefined;
  target: { scope: WorkScope; subject: { pageId: string } };
  operationId: string;
}): unknown[] {
  const m = input.message;
  const name = m.authorName.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, ' ').slice(0, 160);
  const heading = t('discordWork.author', { name });
  const submitted = input.submittedBy
    ? `\n${t('discordWork.submitted', { name: input.submittedBy.displayName ?? input.submittedBy.discordUserId })}`
    : '';
  const content = `${heading}${submitted}\n${m.createdAt}\n\n${m.text}\n`;
  const rich: unknown[] = [];
  for (let offset = 0; offset < content.length; offset += 1800)
    rich.push({ type: 'text', text: { content: content.slice(offset, offset + 1800) } });
  rich.push({
    type: 'text',
    text: {
      content: t('discordWork.source'),
      link: {
        url: `https://discord.com/channels/${input.target.scope.guildId}/${m.channelId}/${m.id}`,
      },
    },
  });
  rich.push({
    type: 'text',
    text: {
      content: ' · Notion',
      link: { url: marker(input.target.subject.pageId, input.operationId) },
    },
  });
  return rich;
}
export function workFailure(error: unknown): WorkOutcome {
  if (
    error instanceof Error &&
    [
      'authority_changed',
      'link_changed',
      'task_project_changed',
      'project_already_linked',
    ].includes(error.message)
  )
    return { state: 'superseded', reason: error.message };
  if (
    error instanceof Error &&
    [
      'audience_changed',
      'project_home_required',
      'message_content_required',
      'forum_tag_required',
    ].includes(error.message)
  )
    return { state: 'failed', reason: error.message };
  if (error instanceof NotionTaskApiError) {
    if (error.effectMayHaveApplied) return { state: 'held', reason: 'unconfirmed_effect' };
    return {
      state: error.retryable ? 'retryable' : 'failed',
      reason: error.code,
      retryAfterMs: error.retryAfterMs,
    };
  }
  if (error instanceof DiscordApiFailure) {
    if (error.kind === 'rate_limited')
      return {
        state: 'retryable',
        reason: 'rate_limited',
        retryAfterMs: error.retryAfterMs ?? 60_000,
      };
    if (error.kind === 'permission_denied') return { state: 'failed', reason: 'permission_denied' };
  }
  return { state: 'held', reason: 'unconfirmed_effect' };
}
export async function currentWorkAudience(
  db: Db,
  providers: WorkProviders,
  c: WorkConversation,
): Promise<boolean> {
  const home = await readProjectHome(db, c.scope, c.homeId);
  if (home?.state !== 'active') return false;
  const current = await providers.discord.inspectDestination(home.destination.channelId);
  if (current.audienceFingerprint !== home.audienceFingerprint) return false;
  const thread = await providers.discord.inspectDestination(c.threadId);
  return thread.canRead && !thread.locked;
}
export async function refreshWorkCard(
  db: Db,
  providers: WorkProviders,
  c: WorkConversation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  if (!context.enabled || c.state !== 'active') return { kind: 'idle' };
  const current = await readWorkConversation(db, context.scope, c.id);
  if (current?.generation !== c.generation || !(await currentWorkAudience(db, providers, current)))
    return { kind: 'paused', reason: 'link_or_audience_changed' };
  const source = await readWorkSource(db, context.taskSourceId, context.scope);
  if (!source || current.subject.kind !== 'task') return { kind: 'idle' };
  const task = await readWorkTask(providers, source, current.subject);
  if (!task) return { kind: 'paused', reason: 'source_unavailable' };
  const home = await readProjectHome(db, context.scope, current.homeId);
  const channelId =
    current.cardChannelId ??
    (home?.destination.kind === 'text' ? home.destination.channelId : current.threadId);
  await providers.discord.editCard({
    channelId,
    messageId: current.starterMessageId,
    card: sharedTaskCard(current, task, 'active'),
  });
  return { kind: 'progress' };
}
function savedMessage(
  payload: Record<string, unknown>,
  operation: WorkOperation,
  c: WorkConversation,
): WorkMessage {
  const row = notionObject(payload.message);
  const text = typeof row.text === 'string' ? row.text : payload.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 12000)
    throw new NotionTaskApiError('invalid_update', 60_000, false);
  return {
    id: discordId(row.id) ? row.id : c.starterMessageId,
    channelId: discordId(row.channelId) ? row.channelId : (c.cardChannelId ?? c.threadId),
    authorId: operation.original_author_id,
    authorName: typeof row.authorName === 'string' ? row.authorName : operation.original_author_id,
    createdAt:
      typeof row.createdAt === 'string' ? row.createdAt : (workString(payload.createdAt, 64) ?? ''),
    text,
    bot: false,
    webhook: false,
    system: false,
    contentAvailable: true,
    attachmentOnly: false,
  };
}
async function writeComment(
  providers: WorkProviders,
  input: {
    operation: WorkOperation;
    c: WorkConversation;
    actor: WorkActor;
    payload: Record<string, unknown>;
  },
): Promise<string> {
  const { operation, c, actor, payload } = input;
  const m = savedMessage(payload, operation, c);
  const rich = workComment({
    message: m,
    actor,
    submittedBy: operation.actor_discord_id !== operation.original_author_id ? actor : undefined,
    target: { scope: c.scope, subject: c.subject },
    operationId: operation.id,
  });
  const result = notionObject(await providers.notion.createTaskComment(c.subject.pageId, rich));
  if (result.object !== 'comment' || typeof result.id !== 'string')
    throw new NotionTaskApiError('unconfirmed_comment', 60_000, false, true);
  return result.id;
}
export async function operationConversation(
  db: Db,
  operation: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkConversation | null> {
  if (operation.conversation_id)
    return readWorkConversation(db, context.scope, operation.conversation_id);
  if (operation.kind !== 'comment' || !operation.home_id) return null;
  const p = notionObject(JSON.parse(operation.payload_json) as unknown),
    subject = workSubject(p.subject),
    m = notionObject(p.message);
  const home = await readProjectHome(db, context.scope, operation.home_id);
  if (!subject || home?.state !== 'active' || home.generation !== operation.generation) return null;
  const channelId = workString(m.channelId),
    messageId = workString(m.id);
  if (!channelId || !messageId) return null;
  return {
    id: operation.id,
    scope: context.scope,
    subject,
    homeId: home.id,
    placementProjectId: home.projectId,
    threadId: channelId,
    starterMessageId: messageId,
    mode: 'selected',
    state: 'active',
    generation: home.generation,
    activationId: messageId,
    cursorId: messageId,
    windowUpperId: null,
    windowBeforeId: null,
    footerBlockIds: [],
  };
}
async function writeStatus(
  db: Db,
  providers: WorkProviders,
  input: { c: WorkConversation; payload: Record<string, unknown> },
  context: WorkEffectContext,
): Promise<WorkOutcome> {
  const { c, payload } = input;
  const status = taskStatus(payload.status);
  if (!status) return { state: 'failed', reason: 'invalid_action' };
  const source = await readWorkSource(db, context.taskSourceId, context.scope);
  if (!source?.policy.actions.complete) return { state: 'superseded', reason: 'action_disabled' };
  const response = notionObject(
    await providers.notion.setTaskStatus(c.subject.pageId, source.policy.fields.status, status),
  );
  if (
    response.id !== c.subject.pageId ||
    notionObject(notionProperty(response, source.policy.fields.status).status).name !==
      payload.status
  )
    throw new NotionTaskApiError('unconfirmed_status', 60_000, false, true);
  return { state: 'confirmed', providerIds: { pageId: c.subject.pageId } };
}
async function applySharedEffect(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkOutcome> {
  if (!context.enabled) return { state: 'retryable', reason: 'disabled' };
  const c = await operationConversation(db, op, context);
  if (!c) return { state: 'superseded', reason: 'link_changed' };
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject: c.subject,
      taskSourceId: context.taskSourceId,
      conversationId: op.conversation_id ?? undefined,
      homeId: c.homeId,
      generation: op.generation,
      discordUserId: op.actor_discord_id,
      action: op.kind === 'status' ? 'set_status' : 'comment',
    },
    context.clock(),
  );
  if (actor?.personId !== op.actor_person_id || actor.grantVersion !== op.grant_version)
    return { state: 'superseded', reason: 'authority_changed' };
  if (!(await currentWorkAudience(db, providers, c)))
    return { state: 'failed', reason: 'audience_or_destination_changed' };
  const payload = notionObject(JSON.parse(op.payload_json) as unknown);
  if (op.kind === 'backlink') {
    const result = await ensureNotionWorkLink(db, providers.notion, c, context.clock());
    return { state: result.kind === 'progress' ? 'confirmed' : 'held', reason: result.reason };
  }
  if (op.kind === 'comment')
    return {
      state: 'confirmed',
      providerIds: {
        commentId: await writeComment(providers, { operation: op, c, actor, payload }),
      },
    };
  if (op.kind !== 'status') return { state: 'failed', reason: 'invalid_action' };
  return writeStatus(db, providers, { c, payload }, context);
}
export async function processWorkAction(
  db: Db,
  providers: WorkProviders,
  operation: WorkOperation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  let outcome: WorkOutcome;
  try {
    outcome = await applySharedEffect(db, providers, operation, context);
  } catch (error) {
    outcome = workFailure(error);
  }
  await settleWorkOperation(
    db,
    { id: operation.id, token: operation.claim_token },
    outcome,
    context.clock(),
  );
  if (outcome.state !== 'confirmed')
    return { kind: outcome.state === 'superseded' ? 'idle' : 'paused', reason: outcome.reason };
  const c = operation.conversation_id
    ? await readWorkConversation(db, context.scope, operation.conversation_id)
    : null;
  if (c && operation.kind === 'status') await refreshWorkCard(db, providers, c, context);
  return { kind: 'progress' };
}
export async function recoverWorkComment(
  db: Db,
  client: NotionTaskClient,
  input: { scope: WorkScope; operation: WorkOperation; conversation: WorkConversation },
  now: Date,
): Promise<WorkResult> {
  const { operation: op, conversation: c } = input;
  if (op.state !== 'held' || op.kind !== 'comment') return { kind: 'idle' };
  const bot = notionObject(await client.readSelf());
  if (bot.type !== 'bot' || typeof bot.id !== 'string')
    return { kind: 'paused', reason: 'invalid_bot' };
  let cursor: string | null = null;
  for (let i = 0; i < 5; i++) {
    const page = await client.listTaskComments(c.subject.pageId, cursor);
    const match = page.results.find((value) => {
      const r = notionObject(value);
      return (
        r.object === 'comment' &&
        typeof r.id === 'string' &&
        notionObject(r.created_by).id === bot.id &&
        notionObject(r.parent).page_id === c.subject.pageId &&
        Array.isArray(r.rich_text) &&
        r.rich_text.some(
          (v) =>
            notionObject(notionObject(notionObject(v).text).link).url ===
            marker(c.subject.pageId, op.id),
        )
      );
    });
    if (match) {
      await db
        .prepare(
          "UPDATE discord_work_operations SET state='confirmed',result_json=?,updated_at=? WHERE scope_key=? AND id=? AND state='held'",
        )
        .bind(
          JSON.stringify({ commentId: notionObject(match).id }),
          now.toISOString(),
          op.scope_key,
          op.id,
        )
        .run();
      return { kind: 'progress' };
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return { kind: 'paused', reason: 'unconfirmed_effect' };
}
