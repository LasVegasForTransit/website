import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { checkpoint } from './discord-work-provision-checkpoint';
import { workString, workSubject } from './discord-work-input';
import { notionObject } from './notion-task-types';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkOperation, WorkConversation } from './discord-work-types';
import type { CreatedConversation, DestinationInspection } from './discord-work-provider';
import type { DiscordTaskMessage } from './notion-task-cards';
type Payload = Record<string, unknown>;

export function priorCreatedName(prior: Payload): { createdName?: string } {
  return typeof prior.createdName === 'string' ? { createdName: prior.createdName } : {};
}

export function managedCreatedName(
  p: Payload,
  kind: string,
  createdName: string | undefined,
  forumOnly = false,
): { managedName?: string } {
  return createdName &&
    !workString(p.adoptThreadId) &&
    kind !== 'thread' &&
    (!forumOnly || kind === 'forum')
    ? { managedName: createdName }
    : {};
}

export function markedCard(card: DiscordTaskMessage, id: string): DiscordTaskMessage {
  const result = structuredClone(card);
  for (const container of result.components)
    for (const section of container.components ?? []) {
      if (section.accessory?.url) {
        const url = new URL(section.accessory.url);
        url.searchParams.set('lvbt_work_create', id);
        section.accessory.url = url.href;
      }
    }
  return result;
}
export function skeleton(
  op: WorkOperation,
  p: Payload,
  context: WorkEffectContext,
): WorkConversation {
  const subject = workSubject(p.subject),
    id = workString(p.linkId),
    audienceFingerprint = workString(p.audienceFingerprint);
  if (!subject || !id) throw new Error('invalid_work_subject');
  return {
    id,
    scope: context.scope,
    subject,
    homeId: op.home_id ?? workString(p.homeId) ?? '',
    placementProjectId: workString(p.projectId) ?? '',
    ...(audienceFingerprint ? { audienceFingerprint } : {}),
    threadId: '0',
    starterMessageId: '0',
    mode: p.mode === 'automatic' ? 'automatic' : 'selected',
    state: 'active',
    generation: 1,
    activationId: '0',
    cursorId: '0',
    windowUpperId: null,
    windowBeforeId: null,
    footerBlockIds: [],
  };
}
export async function createOrRecover(
  db: Db,
  providers: WorkProviders,
  input: {
    op: WorkOperation;
    p: Payload;
    d: DestinationInspection;
    card: DiscordTaskMessage;
    title: string;
  },
  clock: () => Date,
): Promise<CreatedConversation> {
  const { op, p, d, card, title } = input;
  const prior = notionObject(op.result_json ? (JSON.parse(op.result_json) as unknown) : null);
  let created: CreatedConversation;
  if (
    prior.starterOnly === true &&
    typeof prior.starterMessageId === 'string' &&
    typeof prior.cardChannelId === 'string'
  )
    return providers.discord.resumeStarter({
      channelId: prior.cardChannelId,
      starterMessageId: prior.starterMessageId,
      title,
    });
  if (typeof prior.threadId === 'string' && typeof prior.starterMessageId === 'string')
    created = {
      threadId: prior.threadId,
      starterMessageId: prior.starterMessageId,
      ...priorCreatedName(prior),
      ...(typeof prior.cardChannelId === 'string' ? { cardChannelId: prior.cardChannelId } : {}),
    };
  else if (d.destination.kind === 'thread') {
    const messageId = await providers.discord.sendCard(d.destination.channelId, card, op.id);
    created = {
      threadId: d.destination.channelId,
      starterMessageId: messageId,
      cardChannelId: d.destination.channelId,
    };
  } else
    created = await providers.discord.createTaskConversation({
      destination: d,
      title: title,
      card,
      operationId: op.id,
      onStarter: (value) => checkpoint(db, op, { ...value, starterOnly: true }, clock),
      tagIds: Array.isArray(p.tagIds)
        ? p.tagIds.filter((v): v is string => typeof v === 'string')
        : [],
    });
  return created;
}
