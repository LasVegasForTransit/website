import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readWorkConversation,
  updateWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import { notionObject } from './notion-task-types';
import type { WorkConversation, WorkResult } from './discord-work-types';
export function workConversationUrl(c: WorkConversation): string {
  return `https://discord.com/channels/${c.scope.guildId}/${c.threadId}`;
}
function footerUrl(c: WorkConversation): string {
  return `${workConversationUrl(c)}?lvbt_work=${encodeURIComponent(c.id)}`;
}
function matchesBlock(
  value: unknown,
  reference: { botId: string; url: string; previous?: boolean },
): boolean {
  const row = notionObject(value);
  const text = notionObject(row.paragraph).rich_text;
  return (
    row.type === 'paragraph' &&
    notionObject(row.created_by).id === reference.botId &&
    Array.isArray(text) &&
    text.some((t) => {
      const url = notionObject(notionObject(notionObject(t).text).link).url;
      if (url === reference.url) return true;
      if (!reference.previous || typeof url !== 'string') return false;
      try {
        const parsed = new URL(url),
          target = new URL(reference.url);
        return (
          parsed.origin === target.origin &&
          parsed.pathname.split('/')[2] === target.pathname.split('/')[2] &&
          parsed.searchParams.has('lvbt_work')
        );
      } catch {
        return false;
      }
    })
  );
}
export async function findWorkFooter(
  client: NotionTaskClient,
  c: WorkConversation,
  previous = false,
): Promise<string[] | null> {
  const bot = notionObject(await client.readSelf());
  if (bot.type !== 'bot' || typeof bot.id !== 'string') throw new NotionTaskApiError('invalid_bot');
  let cursor: string | null = null;
  for (let i = 0; i < 5; i++) {
    const page = await client.listBlockChildren(c.subject.pageId, cursor);
    const found = page.results.find((v) =>
      matchesBlock(v, { botId: String(bot.id), url: footerUrl(c), previous }),
    );
    if (found) {
      const id = notionObject(found).id;
      if (typeof id !== 'string') throw new NotionTaskApiError('invalid_block');
      return [id];
    }
    if (page.nextCursor === null) return [];
    cursor = page.nextCursor;
  }
  return null;
}
export async function ensureNotionWorkLink(
  db: Db,
  client: NotionTaskClient,
  input: WorkConversation,
  now: Date,
): Promise<WorkResult> {
  const current = await readWorkConversation(db, input.scope, input.id);
  if (current?.generation !== input.generation || current.state !== 'active')
    return { kind: 'idle' };
  const existing = await findWorkFooter(client, current);
  if (existing === null) return { kind: 'paused', reason: 'footer_scan_limit' };
  let ids = existing;
  if (!ids.length) {
    const previous = await findWorkFooter(client, current, true);
    if (previous === null) return { kind: 'paused', reason: 'footer_scan_limit' };
    const [id] = previous;
    if (id) {
      await client.updateBlock(id, {
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: 'Open the Discord conversation', link: { url: footerUrl(current) } },
            },
          ],
        },
      });
      await updateWorkConversation(db, { ...current, footerBlockIds: previous }, now);
      return { kind: 'progress' };
    }
    const response = notionObject(
      await client.appendBlockChildren(current.subject.pageId, [
        { object: 'block', type: 'divider', divider: {} },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: 'Open the Discord conversation',
                  link: { url: footerUrl(current) },
                },
              },
            ],
          },
        },
      ]),
    );
    if (!Array.isArray(response.results) || response.results.length !== 2)
      throw new NotionTaskApiError('unconfirmed_footer', 60_000, false, true);
    ids = response.results
      .map((v) => notionObject(v).id)
      .filter((id): id is string => typeof id === 'string');
    if (ids.length !== 2) throw new NotionTaskApiError('unconfirmed_footer', 60_000, false, true);
  }
  await updateWorkConversation(db, { ...current, footerBlockIds: ids }, now);
  return { kind: 'progress' };
}
