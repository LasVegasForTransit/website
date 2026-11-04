import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readWorkConversation,
  saveWorkFooterBlockIds,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import { notionObject } from './notion-task-types';
import type { WorkConversation, WorkResult } from './discord-work-types';
import { canWriteFooter, type FooterWriteOptions } from './notion-work-footer-guard';
import { appendManagedFooter } from './notion-work-footer-write';
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

async function scanFooterBlocks(
  client: NotionTaskClient,
  c: WorkConversation,
): Promise<{ botId: string; blocks: Record<string, unknown>[] } | null> {
  const bot = notionObject(await client.readSelf());
  if (bot.type !== 'bot' || typeof bot.id !== 'string') throw new NotionTaskApiError('invalid_bot');
  const blocks: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 5; i++) {
    const page = await client.listBlockChildren(c.subject.pageId, cursor);
    blocks.push(...page.results.map(notionObject));
    if (page.nextCursor === null) return { botId: bot.id, blocks };
    cursor = page.nextCursor;
  }
  return null;
}

function managedDivider(block: Record<string, unknown> | undefined, botId: string): boolean {
  return block?.type === 'divider' && notionObject(block.created_by).id === botId;
}

function untouchedFooter(
  block: Record<string, unknown>,
  botId: string,
  url: string,
  previous = false,
): boolean {
  const paragraph = notionObject(block.paragraph);
  const richText = paragraph.rich_text;
  if (
    !matchesBlock(block, { botId, url, previous }) ||
    block.has_children === true ||
    !Array.isArray(richText)
  )
    return false;
  if (richText.length !== 1 || (paragraph.color !== undefined && paragraph.color !== 'default'))
    return false;
  const item = notionObject(richText[0]);
  const annotations = notionObject(item.annotations);
  return (
    notionObject(item.text).content === 'Open the Discord conversation' &&
    ['bold', 'italic', 'strikethrough', 'underline', 'code'].every(
      (name) => annotations[name] === undefined || annotations[name] === false,
    ) &&
    (annotations.color === undefined || annotations.color === 'default') &&
    Object.keys(annotations).every((name) =>
      ['bold', 'italic', 'strikethrough', 'underline', 'code', 'color'].includes(name),
    )
  );
}

async function archiveManagedBlock(client: NotionTaskClient, id: string): Promise<void> {
  const response = notionObject(await client.updateBlock(id, { archived: true }));
  if (response.id !== id || (response.archived !== true && response.in_trash !== true))
    throw new NotionTaskApiError('unconfirmed_footer_archive', 60_000, false, true);
}

function inspectPriorFooter(
  scan: FooterScan,
  c: WorkConversation,
  {
    latest,
    divider,
    matches,
    url,
  }: { latest: FooterMatch; divider: Record<string, unknown>; matches: FooterMatch[]; url: string },
): { kind: 'retry' } | { kind: 'unknown' } {
  const [oldDividerId, oldLinkId] = c.footerBlockIds;
  if (!oldDividerId || !oldLinkId) return { kind: 'unknown' };
  const oldLink = scan.blocks.find((block) => block.id === oldLinkId);
  const oldDivider = scan.blocks.find((block) => block.id === oldDividerId);
  if (
    !oldLink ||
    !untouchedFooter(oldLink, scan.botId, url) ||
    (oldDivider && !managedDivider(oldDivider, scan.botId))
  )
    return { kind: 'unknown' };
  if (matches.length === 1 && oldDivider?.id === divider.id && oldLink.id === latest.block.id)
    return { kind: 'retry' };
  if (
    matches.length === 2 &&
    latest.index === scan.blocks.length - 1 &&
    oldLink.id !== latest.block.id
  )
    return { kind: 'retry' };
  return { kind: 'unknown' };
}

export async function inspectFooterRecovery(
  client: NotionTaskClient,
  c: WorkConversation,
): Promise<{ kind: 'confirmed'; ids: string[] } | { kind: 'retry' } | { kind: 'unknown' }> {
  const scan = await scanFooterBlocks(client, c);
  if (!scan) return { kind: 'unknown' };
  const url = footerUrl(c);
  const matches = scan.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => matchesBlock(block, { botId: scan.botId, url }));
  if (
    !matches.length ||
    matches.length > 2 ||
    matches.some(({ block }) => !untouchedFooter(block, scan.botId, url))
  )
    return { kind: 'unknown' };
  const latest = matches.at(-1);
  if (!latest || typeof latest.block.id !== 'string') return { kind: 'unknown' };
  const divider = scan.blocks[latest.index - 1];
  if (!managedDivider(divider, scan.botId) || typeof divider?.id !== 'string')
    return { kind: 'unknown' };
  if (matches.length === 1 && latest.index === scan.blocks.length - 1)
    return { kind: 'confirmed', ids: [divider.id, latest.block.id] };
  return inspectPriorFooter(scan, c, { latest, divider, matches, url });
}

type FooterScan = NonNullable<Awaited<ReturnType<typeof scanFooterBlocks>>>;
interface FooterMatch {
  block: Record<string, unknown>;
  index: number;
}
async function archiveOldLink(
  db: Db,
  client: NotionTaskClient,
  input: WorkConversation,
  { id, botId, url }: { id: string; botId: string; url: string },
): Promise<WorkResult | null> {
  const link = notionObject(await client.readBlock(id));
  if (link.id !== id) return { kind: 'paused', reason: 'footer_ownership_unverified' };
  if (!untouchedFooter(link, botId, url)) return { kind: 'paused', reason: 'footer_modified' };
  if (!(await canWriteFooter(db, input))) return { kind: 'paused', reason: 'link_changed' };
  await archiveManagedBlock(client, id);
  return null;
}
async function archiveOldFooter(
  db: Db,
  client: NotionTaskClient,
  {
    current,
    input,
    scan,
    newIds,
    url,
    beforeWrite,
  }: {
    current: WorkConversation;
    input: WorkConversation;
    scan: FooterScan;
    newIds: string[];
    url: string;
    beforeWrite?: (() => Promise<boolean>) | undefined;
  },
): Promise<WorkResult | null> {
  const [oldDividerId, oldLinkId] = current.footerBlockIds;
  if (!oldDividerId || !oldLinkId || newIds.includes(oldLinkId))
    return { kind: 'paused', reason: 'footer_ownership_unverified' };
  if (!(await canWriteFooter(db, input, beforeWrite)))
    return { kind: 'paused', reason: 'link_changed' };
  const fresh = await scanFooterBlocks(client, current);
  if (fresh?.botId !== scan.botId) return { kind: 'paused', reason: 'footer_scan_limit' };
  const oldDivider = fresh.blocks.find((block) => block.id === oldDividerId);
  const oldLink = fresh.blocks.find((block) => block.id === oldLinkId);
  if (
    (oldDivider && !managedDivider(oldDivider, scan.botId)) ||
    (oldLink && !untouchedFooter(oldLink, scan.botId, url))
  )
    return { kind: 'paused', reason: 'footer_modified' };
  if (!(await canWriteFooter(db, input))) return { kind: 'paused', reason: 'link_changed' };
  if (oldDivider) await archiveManagedBlock(client, oldDividerId);
  if (oldLink) return archiveOldLink(db, client, input, { id: oldLinkId, botId: scan.botId, url });
  return null;
}

async function reconcileCurrentFooter(
  db: Db,
  client: NotionTaskClient,
  now: Date,
  {
    current,
    input,
    scan,
    matches,
    latest,
    url,
    beforeWrite,
  }: {
    current: WorkConversation;
    input: WorkConversation;
    scan: FooterScan;
    matches: FooterMatch[];
    latest: FooterMatch;
    url: string;
    beforeWrite?: (() => Promise<boolean>) | undefined;
  },
): Promise<WorkResult> {
  const divider = scan.blocks[latest.index - 1];
  if (
    !managedDivider(divider, scan.botId) ||
    typeof divider?.id !== 'string' ||
    typeof latest.block.id !== 'string'
  )
    return { kind: 'paused', reason: 'footer_ownership_unverified' };
  let newIds = [divider.id, latest.block.id];
  if (matches.length === 1 && latest.index < scan.blocks.length - 1) {
    if (
      !current.footerBlockIds.includes(divider.id) ||
      !current.footerBlockIds.includes(latest.block.id)
    )
      return { kind: 'paused', reason: 'footer_ownership_unverified' };
    newIds = await appendManagedFooter(client, current.subject.pageId, url);
  } else if (latest.index !== scan.blocks.length - 1) {
    return { kind: 'paused', reason: 'footer_changed_during_repair' };
  }
  if (matches.length > 1 || newIds[1] !== latest.block.id) {
    const outcome = await archiveOldFooter(db, client, {
      current,
      input,
      scan,
      newIds,
      url,
      beforeWrite,
    });
    if (outcome) return outcome;
  }
  const saved = await saveWorkFooterBlockIds(
    db,
    { scope: current.scope, id: current.id, generation: current.generation, ids: newIds },
    now,
  );
  return saved ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
}

async function relinkPreviousFooter(
  db: Db,
  client: NotionTaskClient,
  now: Date,
  {
    prior,
    scan,
    input,
    current,
    url,
  }: {
    prior: FooterMatch;
    scan: FooterScan;
    input: WorkConversation;
    current: WorkConversation;
    url: string;
  },
): Promise<WorkResult> {
  if (!untouchedFooter(prior.block, scan.botId, url, true))
    return { kind: 'paused', reason: 'footer_modified' };
  const divider = scan.blocks[prior.index - 1];
  const id = prior.block.id;
  if (
    typeof id !== 'string' ||
    !managedDivider(divider, scan.botId) ||
    typeof divider?.id !== 'string' ||
    current.footerBlockIds.length !== 2 ||
    current.footerBlockIds[0] !== divider.id ||
    current.footerBlockIds[1] !== id
  )
    return { kind: 'paused', reason: 'footer_ownership_unverified' };
  const live = await readWorkConversation(db, input.scope, input.id);
  if (live?.generation !== input.generation || live.state !== 'active') return { kind: 'idle' };
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
  const saved = await saveWorkFooterBlockIds(
    db,
    {
      scope: current.scope,
      id: current.id,
      generation: current.generation,
      ids: [divider.id, id],
    },
    now,
  );
  return saved ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
}

export async function ensureNotionWorkLink(
  db: Db,
  client: NotionTaskClient,
  input: WorkConversation,
  options: Date | FooterWriteOptions,
): Promise<WorkResult> {
  const { now, beforeWrite } =
    options instanceof Date ? { now: options, beforeWrite: undefined } : options;
  const current = await readWorkConversation(db, input.scope, input.id);
  if (current?.generation !== input.generation || current.state !== 'active')
    return { kind: 'idle', reason: 'link_changed' };
  const scan = await scanFooterBlocks(client, current);
  if (scan === null) return { kind: 'paused', reason: 'footer_scan_limit' };
  if (!(await canWriteFooter(db, input, beforeWrite)))
    return { kind: 'idle', reason: 'link_changed' };
  const url = footerUrl(current);
  const matches = scan.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => matchesBlock(block, { botId: scan.botId, url }));
  if (matches.some(({ block }) => !untouchedFooter(block, scan.botId, url)))
    return { kind: 'paused', reason: 'footer_modified' };
  if (matches.length > 2) return { kind: 'paused', reason: 'multiple_managed_footers' };
  const latest = matches.at(-1);
  if (latest)
    return reconcileCurrentFooter(db, client, now, {
      current,
      input,
      scan,
      matches,
      latest,
      url,
      beforeWrite,
    });
  const previous = scan.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => matchesBlock(block, { botId: scan.botId, url, previous: true }));
  if (previous.length > 1) return { kind: 'paused', reason: 'multiple_managed_footers' };
  const prior = previous[0];
  if (prior) return relinkPreviousFooter(db, client, now, { prior, scan, input, current, url });
  if (current.footerBlockIds.length) {
    const recordedLink = current.footerBlockIds.at(-1);
    return {
      kind: 'paused',
      reason: scan.blocks.some((block) => block.id === recordedLink)
        ? 'footer_modified'
        : 'footer_missing',
    };
  }
  const ids = await appendManagedFooter(client, current.subject.pageId, footerUrl(current));
  const saved = await saveWorkFooterBlockIds(
    db,
    { scope: current.scope, id: current.id, generation: current.generation, ids },
    now,
  );
  return saved ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
}
