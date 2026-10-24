import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  enqueueWorkOperation,
  readWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { taskMarkdown } from './notion-task-cards';
import { workMessage, workText, workButton, workCustomId } from './discord-work-cards';
import { notionObject } from './notion-task-types';
import type { WorkActor, WorkOperation } from './discord-work-types';
import type { WorkEffectContext } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';
export function setupReply(text: string): WorkPreviewResult {
  return { kind: 'ready', card: workMessage([workText(text)]) };
}
export async function setupReceipt(
  db: Db,
  input: { request: WorkPreviewInput; actor: WorkActor; payload: Record<string, unknown> },
  context: WorkEffectContext,
): Promise<WorkOperation> {
  const { request, actor, payload } = input,
    id = crypto.randomUUID();
  await enqueueWorkOperation(
    db,
    {
      id,
      scope: context.scope,
      homeId: null,
      conversationId: null,
      generation: 1,
      kind: 'provision',
      sourceKey: `preview:${request.interactionId}:${id}`,
      actorPersonId: actor.personId,
      actorDiscordId: actor.discordUserId,
      grantVersion: actor.grantVersion,
      originalAuthorId: actor.discordUserId,
      payload: { ...payload, taskSourceId: context.taskSourceId },
      preview: true,
    },
    context.clock(),
  );
  const receipt = await readWorkOperation(db, context.scope, id);
  if (!receipt) throw new Error('preview_unavailable');
  return receipt;
}
export async function ownedReceipt(
  db: Db,
  input: WorkPreviewInput,
  context: WorkEffectContext,
): Promise<WorkOperation | null> {
  const receipt = await readWorkOperation(db, context.scope, input.intent.linkId ?? '');
  if (
    receipt?.actor_discord_id !== input.discordUserId ||
    !receipt.expires_at ||
    receipt.expires_at <= context.clock().toISOString()
  )
    return null;
  return ['preview', 'superseded'].includes(receipt.state) ? receipt : null;
}
export function receiptCard(receipt: WorkOperation, context: WorkEffectContext): WorkPreviewResult {
  const p = notionObject(JSON.parse(receipt.payload_json) as unknown);
  const title = typeof p.title === 'string' ? p.title : 'Linked work';
  const rows = [
    workText(`### ${taskMarkdown(title)}`),
    workText(typeof p.description === 'string' ? p.description : t('discordWork.audience')),
  ];
  const tags = Array.isArray(p.availableTags) ? p.availableTags.map(notionObject) : [];
  const chosen = Array.isArray(p.tagIds) ? p.tagIds : [];
  if (p.requiredTag === true && tags.length > 1)
    rows.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: workCustomId({ id: receipt.id, generation: 1 }, 'tag'),
          placeholder: t('discordWork.chooseTag'),
          options: tags.slice(0, 25).map((tag) => ({
            label: String(tag.name).slice(0, 100),
            value: String(tag.id),
            default: chosen.includes(tag.id),
          })),
        },
      ],
    });
  const disabled = !context.enabled || (p.requiredTag === true && !chosen.length);
  rows.push({
    type: 1,
    components: [
      workButton(
        workCustomId({ id: receipt.id, generation: 1 }, 'confirm'),
        p.intent === 'comment' ? t('discordWork.save') : t('discordWork.confirm'),
        disabled,
      ),
    ],
  });
  if (!context.enabled) rows.push(workText(t('discordWork.disabled')));
  return { kind: 'ready', card: workMessage(rows) };
}
