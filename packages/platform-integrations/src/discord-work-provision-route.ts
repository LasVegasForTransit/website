import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { readWorkRoute } from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { projectRouteSourceMatches } from './discord-work-route-preview';
import { resolveEventProjectForum } from './discord-work-event-project';
import { assertProvisionCurrent } from './discord-work-provision-checkpoint';
import { notionObject } from './notion-task-types';
import type { WorkProviders, WorkEffectContext } from './discord-work-actions';
import type { WorkOperation, WorkSubject } from './discord-work-types';

export class IneligibleWorkPage extends Error {
  constructor(readonly editedAt: string) {
    super('not_eligible');
  }
}

type Route = NonNullable<Awaited<ReturnType<typeof readWorkRoute>>>;
const normalize = (value: unknown) =>
  typeof value === 'string' ? value.replaceAll('-', '').toLowerCase() : '';

function validateProvisionPage(
  page: Record<string, unknown>,
  route: Route,
  subject: WorkSubject,
): void {
  const field = notionObject(notionObject(page.properties)[route.trigger.property]);
  const validIdentity =
    page.object === 'page' &&
    normalize(page.id) === normalize(subject.pageId) &&
    normalize(notionObject(page.parent).data_source_id) === normalize(route.sourceId);
  const ineligible =
    page.archived === true ||
    page.in_trash === true ||
    (field.type !== 'status' && field.type !== 'select') ||
    !route.trigger.values.some((value) => notionObject(field[field.type as string]).name === value);
  if (validIdentity && ineligible && typeof page.last_edited_time === 'string') {
    const edited = new Date(page.last_edited_time);
    if (Number.isFinite(edited.getTime())) throw new IneligibleWorkPage(edited.toISOString());
  }
  if (!validIdentity || ineligible) throw new Error('not_eligible');
}

async function validateProjectRoute(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  { route, page, p }: { route: Route; page: Record<string, unknown>; p: Record<string, unknown> },
): Promise<void> {
  if (route.kind === 'event' && route.projectRelation) {
    if (
      !(await projectRouteSourceMatches(
        db,
        context.scope,
        context.taskSourceId,
        route.projectRelation.projectSourceId,
      )) ||
      route.destination.kind !== 'category'
    )
      throw new Error('link_changed');
    const resolved = await resolveEventProjectForum(db, providers, context.scope, {
      page,
      relation: route.projectRelation.property,
      projectSourceId: route.projectRelation.projectSourceId,
      categoryId: route.destination.channelId,
      audienceFingerprint: route.audienceFingerprint,
      ignoreTags: Boolean(p.adoptThreadId),
    });
    if (resolved.kind !== 'ready')
      throw new Error(resolved.reason === 'forum_tag_required' ? resolved.reason : 'link_changed');
    if (resolved.forumId !== p.destinationId || resolved.projectId !== p.projectId)
      throw new Error('link_changed');
    p.tagIds = resolved.tagIds;
  }
}

export async function refreshProvisionRoute(
  db: Db,
  providers: WorkProviders,
  op: WorkOperation,
  {
    context,
    p,
    subject,
  }: { context: WorkEffectContext; p: Record<string, unknown>; subject: WorkSubject },
): Promise<void> {
  if (p.routeId !== undefined || p.routeRevision !== undefined) {
    if (
      typeof p.routeId !== 'string' ||
      typeof p.routeRevision !== 'number' ||
      !['project_plan', 'event_plan'].includes(subject.kind)
    )
      throw new Error('link_changed');
    await assertProvisionCurrent(db, op, context.clock);
    const route = await readWorkRoute(db, context.scope, p.routeId);
    if (
      route?.state !== 'active' ||
      route.revision !== p.routeRevision ||
      (route.kind === 'project' ? subject.kind !== 'project_plan' : subject.kind !== 'event_plan')
    )
      throw new Error('link_changed');
    const page = notionObject(await providers.notion.readPage(subject.pageId));
    validateProvisionPage(page, route, subject);
    await validateProjectRoute(db, providers, context, { route, page, p });
    const titleProperty = Object.values(notionObject(page.properties))
      .map(notionObject)
      .find((property) => property.type === 'title');
    const title = Array.isArray(titleProperty?.title)
      ? titleProperty.title
          .map((part) => {
            const text = notionObject(part).plain_text;
            return typeof text === 'string' ? text : '';
          })
          .join('')
          .trim()
          .slice(0, 100)
      : '';
    if (!title) throw new Error('not_eligible');
    p.title = title;
  }
}
