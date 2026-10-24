import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { readWorkConversation } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { notionObject } from './notion-task-types';
import { discordId } from './discord-types';
import { workMessage, workText } from './discord-work-cards';
import { workString } from './discord-work-input';
import type { DiscordTaskMessage } from './notion-task-cards';
import type { WorkScope, WorkMessage } from './discord-work-types';
export interface WorkIntent {
  action: string;
  linkId?: string | undefined;
  generation?: number | undefined;
  value?: string | undefined;
  messageId?: string | undefined;
  url?: string | undefined;
  destinationId?: string | undefined;
  message?: WorkMessage;
  text?: string | undefined;
}
export interface WorkPreviewInput {
  applicationId: string;
  guildId: string;
  discordUserId: string;
  channelId: string;
  interactionId: string;
  intent: WorkIntent;
}
export type WorkPreviewResult =
  { kind: 'ready'; card: DiscordTaskMessage } | { kind: 'unavailable'; reason: string };
export interface WorkPreviewBinding {
  preview(input: WorkPreviewInput): Promise<WorkPreviewResult>;
}
export interface WorkInteractionContext {
  applicationId: string;
  guildId: string;
  enabled: boolean;
  scope?: WorkScope | undefined;
  loadScope?: (() => Promise<WorkScope | undefined>) | undefined;
  preview: WorkPreviewBinding;
  waitUntil: (p: Promise<unknown>) => void;
  fetcher?: typeof fetch | undefined;
}
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
function privateText(text: string) {
  return json({ type: 4, data: { ...workMessage([workText(text)]), flags: 32832 } });
}
function parseControl(data: Record<string, unknown>): WorkIntent | null {
  const value = workString(data.custom_id, 100);
  if (!value) return null;
  const match = /^work:([\w-]{1,64}):(\d{1,9}):([\w-]{1,24})(?::(\d{17,20}))?$/.exec(value);
  if (!match?.[1] || !match[3]) return null;
  const values = Array.isArray(data.values) ? data.values : [];
  return {
    action: match[3],
    linkId: match[1],
    generation: Number(match[2]),
    value: workString(values[0], 128) ?? undefined,
    messageId: match[4],
  };
}
function command(data: Record<string, unknown>): WorkIntent | null {
  const options = Array.isArray(data.options) ? data.options : [],
    sub = notionObject(options[0]);
  const values = Array.isArray(sub.options) ? sub.options : [];
  const option = (name: string) =>
    workString(notionObject(values.find((v) => notionObject(v).name === name)).value, 1000) ??
    undefined;
  if (!['link', 'show', 'unlink'].includes(String(sub.name))) return null;
  return { action: String(sub.name), url: option('url'), destinationId: option('destination') };
}
function selectedMessage(data: Record<string, unknown>, channelId: string): WorkMessage | null {
  const target = workString(data.target_id),
    r = notionObject(notionObject(notionObject(data.resolved).messages)[target ?? '']);
  const author = notionObject(r.author);
  if (
    !target ||
    r.id !== target ||
    r.channel_id !== channelId ||
    !discordId(author.id) ||
    typeof r.content !== 'string' ||
    r.content.length > 12000
  )
    return null;
  return {
    id: target,
    channelId,
    authorId: author.id,
    authorName:
      workString(author.global_name, 160) ??
      workString(author.username, 160) ??
      'Discord participant',
    createdAt: workString(r.timestamp, 64) ?? '',
    text: r.content,
    bot: author.bot === true,
    webhook: typeof r.webhook_id === 'string',
    system: false,
    contentAvailable: true,
    attachmentOnly: !r.content && Array.isArray(r.attachments) && r.attachments.length > 0,
  };
}
function modalText(data: Record<string, unknown>): string | null {
  const rows = Array.isArray(data.components) ? data.components : [];
  for (const row of rows) {
    const r = notionObject(row),
      children = Array.isArray(r.components) ? r.components : [];
    for (const child of children) {
      const field = notionObject(child);
      if (field.custom_id === 'text') return workString(field.value, 1800);
    }
  }
  return null;
}
async function noteModal(
  db: Db,
  input: WorkPreviewInput,
  context: WorkInteractionContext,
): Promise<Response> {
  if (!context.enabled) return privateText(t('discordWork.disabled'));
  const scope = context.scope ?? (await context.loadScope?.());
  if (!scope) return privateText(t('discordWork.unavailable'));
  const c = await readWorkConversation(db, scope, input.intent.linkId ?? '');
  if (
    !c ||
    c.generation !== input.intent.generation ||
    c.starterMessageId !== input.intent.messageId
  )
    return privateText(t('discordWork.unavailable'));
  const custom = `work:${c.id}:${c.generation}:note-submit:${c.starterMessageId}`;
  if (custom.length > 100) return privateText(t('discordWork.unavailable'));
  return json({
    type: 9,
    data: {
      custom_id: custom,
      title: t('discordWork.noteTitle'),
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: 'text',
              style: 2,
              label: t('discordWork.noteLabel'),
              required: true,
              max_length: 1800,
            },
          ],
        },
      ],
    },
  });
}
async function completePrivate(
  input: WorkPreviewInput,
  token: string,
  context: WorkInteractionContext,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      context.preview.preview(input),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('work_preview_timeout')), 25_000);
      }),
    ]);
    const card =
      result.kind === 'ready' ? result.card : workMessage([workText(t('discordWork.unavailable'))]);
    await (context.fetcher ?? fetch)(
      `https://discord.com/api/v10/webhooks/${context.applicationId}/${token}/messages/@original`,
      {
        method: 'PATCH',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...card, flags: 32832 }),
      },
    );
  } catch {
    await (context.fetcher ?? fetch)(
      `https://discord.com/api/v10/webhooks/${context.applicationId}/${token}/messages/@original`,
      {
        method: 'PATCH',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...workMessage([workText(t('discordWork.retry'))]), flags: 32832 }),
      },
    ).catch(() => undefined);
  } finally {
    clearTimeout(timer);
  }
}
function intentFor(
  row: Record<string, unknown>,
  data: Record<string, unknown>,
  channelId: string,
): WorkIntent | null {
  if (data.name === 'work' && row.type === 2) return command(data);
  if (data.name === 'Save to Notion' && row.type === 2) {
    const message = selectedMessage(data, channelId);
    return message ? { action: 'save-message', message } : null;
  }
  const intent = parseControl(data);
  if (!intent) return null;
  if (row.type === 5) intent.text = modalText(data) ?? undefined;
  const origin = notionObject(row.message);
  if (row.type === 3 && typeof origin.id === 'string') intent.messageId = origin.id;
  return intent;
}
export async function handleWorkInteraction(
  db: Db,
  value: unknown,
  context: WorkInteractionContext,
): Promise<Response | null> {
  const row = notionObject(value),
    data = notionObject(row.data);
  const owned =
    data.name === 'work' ||
    data.name === 'Save to Notion' ||
    (typeof data.custom_id === 'string' && data.custom_id.startsWith('work:'));
  if (!owned) return null;
  if (row.application_id !== context.applicationId || row.guild_id !== context.guildId)
    return json({ error: 'forbidden' }, 403);
  const user = notionObject(notionObject(row.member).user),
    channelId = workString(row.channel_id),
    interactionId = workString(row.id),
    token = workString(row.token, 512);
  if (!discordId(user.id) || !channelId || !interactionId || !token)
    return privateText(t('discordWork.unavailable'));
  const intent = intentFor(row, data, channelId);
  if (!intent) return privateText(t('discordWork.unavailable'));
  const input = {
    applicationId: context.applicationId,
    guildId: context.guildId,
    discordUserId: user.id,
    channelId,
    interactionId,
    intent,
  };
  if (intent.action === 'note') {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        noteModal(db, input, context),
        new Promise<Response>((resolve) => {
          timer = setTimeout(() => resolve(privateText(t('discordWork.retry'))), 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  context.waitUntil(completePrivate(input, token, context));
  return json({ type: 5, data: { flags: 64 } });
}
