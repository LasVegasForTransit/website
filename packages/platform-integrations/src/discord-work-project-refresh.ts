import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readProjectHome,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { workScopeKey } from '@lasvegasfortransit/platform-storage/discord-work-types';
import { authorizeWork } from './discord-work-authority';
import {
  currentWorkAudience,
  type WorkEffectContext,
  type WorkProviders,
} from './discord-work-actions';
import { eventWorkCard, projectWorkCard } from './discord-work-cards';
import { queueWorkTagSync } from './discord-work-tag-sync';
import { notionObject } from './notion-task-types';
import type { ProjectHome, WorkConversation, WorkResult } from './discord-work-types';

async function authorizedOrigin(
  db: Db,
  providers: WorkProviders,
  c: WorkConversation,
  context: WorkEffectContext,
) {
  const origin = await db
    .prepare(
      "SELECT id,actor_person_id,actor_discord_id,grant_version FROM discord_work_operations WHERE scope_key=? AND home_id=? AND kind='provision' AND state='confirmed' AND json_extract(payload_json,'$.intent')=? ORDER BY created_at LIMIT 1",
    )
    .bind(workScopeKey(context.scope), c.homeId, c.subject.kind === 'event_plan' ? 'event' : 'home')
    .first<{
      id: string;
      actor_person_id: string;
      actor_discord_id: string;
      grant_version: string;
    }>();
  if (!origin) return { kind: 'paused' as const, reason: 'authority_unavailable' };
  const actor = await authorizeWork(
    db,
    providers,
    {
      scope: context.scope,
      subject: c.subject,
      taskSourceId: context.taskSourceId,
      homeId: c.homeId,
      conversationId: c.id,
      generation: c.generation,
      discordUserId: origin.actor_discord_id,
      action: 'manage_home',
    },
    context.clock(),
  );
  if (actor?.personId !== origin.actor_person_id || actor.grantVersion !== origin.grant_version)
    return { kind: 'paused' as const, reason: 'authority_changed' };
  return { kind: 'ready' as const, id: origin.id };
}

async function planningPage(providers: WorkProviders, c: WorkConversation) {
  const page = notionObject(await providers.notion.readPage(c.subject.pageId));
  const canonical = (value: unknown) =>
    typeof value === 'string' ? value.replaceAll('-', '').toLowerCase() : '';
  if (
    page.object !== 'page' ||
    canonical(page.id) !== canonical(c.subject.pageId) ||
    canonical(notionObject(page.parent).data_source_id) !== canonical(c.subject.sourceId) ||
    page.archived === true ||
    page.in_trash === true
  )
    return null;
  const property = Object.values(notionObject(page.properties))
    .map(notionObject)
    .find((p) => p.type === 'title');
  const title = Array.isArray(property?.title)
    ? property.title
        .map((part) => {
          const text = notionObject(part).plain_text;
          return typeof text === 'string' ? text : '';
        })
        .join('')
        .trim()
        .slice(0, 100)
    : '';
  if (!title) return null;
  return { title, lastEditedTime: page.last_edited_time };
}

function overviewCard(home: ProjectHome, c: WorkConversation, title: string, operationId: string) {
  const card =
    c.subject.kind === 'event_plan'
      ? eventWorkCard({ title, pageId: c.subject.pageId })
      : projectWorkCard(
          home,
          { title, url: `https://www.notion.so/${c.subject.pageId}` },
          'active',
        );
  for (const container of card.components)
    for (const section of container.components ?? [])
      if (section.accessory?.url) {
        const url = new URL(section.accessory.url);
        url.searchParams.set('lvbt_work_create', operationId);
        section.accessory.url = url.href;
      }
  return card;
}

async function currentPlanningConversation(
  db: Db,
  providers: WorkProviders,
  c: WorkConversation,
  context: WorkEffectContext,
): Promise<WorkConversation | null> {
  const current = await readWorkConversation(db, context.scope, c.id);
  if (
    current?.state !== 'active' ||
    current.generation !== c.generation ||
    !(await currentWorkAudience(db, providers, current))
  )
    return null;
  return current;
}

/** Refresh only the bot-authored overview; the forum, post title and human content remain untouched. */
export async function refreshPlanningOverview(
  db: Db,
  providers: WorkProviders,
  c: WorkConversation,
  context: WorkEffectContext,
): Promise<WorkResult> {
  if (
    !context.enabled ||
    c.state !== 'active' ||
    !['project_plan', 'event_plan'].includes(c.subject.kind)
  )
    return { kind: 'idle' };
  const home = await readProjectHome(db, context.scope, c.homeId);
  if (home?.state !== 'active' || !(await currentWorkAudience(db, providers, c)))
    return { kind: 'paused', reason: 'link_or_audience_changed' };
  const origin = await authorizedOrigin(db, providers, c, context);
  if (origin.kind === 'paused') return origin;
  const page = await planningPage(providers, c);
  if (!page) return { kind: 'paused', reason: 'source_unavailable' };
  const { title } = page;
  const tagQueued = await queueWorkTagSync(db, c, page.lastEditedTime, context);
  if (home.title === title) return { kind: tagQueued ? 'progress' : 'idle' };
  const card = overviewCard(home, c, title, origin.id);
  const current = await currentPlanningConversation(db, providers, c, context);
  if (!current) return { kind: 'paused', reason: 'link_or_audience_changed' };
  await providers.discord.editCard({
    channelId: current.cardChannelId ?? current.threadId,
    messageId: current.starterMessageId,
    card,
  });
  const result = await db
    .prepare(
      "UPDATE discord_project_homes SET data_json=json_set(data_json,'$.title',?),updated_at=? WHERE id=? AND scope_key=? AND generation=? AND state='active'",
    )
    .bind(
      title,
      context.clock().toISOString(),
      home.id,
      workScopeKey(context.scope),
      home.generation,
    )
    .run();
  return result.meta.changes ? { kind: 'progress' } : { kind: 'paused', reason: 'link_changed' };
}
