import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { findProjectHome } from '@lasvegasfortransit/platform-storage/discord-work-links';
import type { WorkScope } from '@lasvegasfortransit/platform-storage/discord-work-types';
import { propertyValues } from './notion-task-hydrate';
import { notionObject, notionProperty } from './notion-task-types';
import type { WorkProviders } from './discord-work-actions';
import type { ProjectHome } from './discord-work-types';

interface EventProjectInput {
  page: unknown;
  relation: string;
  projectSourceId: string;
  categoryId: string;
  audienceFingerprint: string;
  ignoreTags?: boolean;
}
type ProjectResolution =
  | { kind: 'ready'; projectId: string; forumId: string; tagIds: string[] }
  | { kind: 'unavailable'; reason: string };
const unavailable = (reason: string): ProjectResolution => ({ kind: 'unavailable', reason });
const canonical = (value: unknown) =>
  typeof value === 'string' ? value.replaceAll('-', '').toLowerCase() : '';

async function relatedProject(providers: WorkProviders, input: EventProjectInput) {
  const page = notionObject(input.page),
    property = notionProperty(page, input.relation);
  if (
    typeof page.id !== 'string' ||
    property.type !== 'relation' ||
    !Array.isArray(property.relation)
  )
    return { error: 'project_relation_unavailable' } as const;
  const values =
    property.has_more === true
      ? typeof property.id === 'string'
        ? await propertyValues(providers.notion, page.id, property.id, 'relation')
        : null
      : property.relation;
  if (!values) return { error: 'project_relation_unavailable' } as const;
  const ids = values.map((value) => canonical(notionObject(value).id));
  const projectId = ids[0];
  if (!projectId || ids.some((id) => !/^[0-9a-f]{32}$/.test(id)) || new Set(ids).size !== 1)
    return { error: 'project_choice_required' } as const;
  const linked = notionObject(await providers.notion.readPage(projectId));
  if (
    linked.object !== 'page' ||
    canonical(linked.id) !== projectId ||
    canonical(notionObject(linked.parent).data_source_id) !== canonical(input.projectSourceId) ||
    linked.archived === true ||
    linked.in_trash === true
  )
    return { error: 'project_forum_unavailable' } as const;
  return { projectId } as const;
}

async function approvedForum(
  providers: WorkProviders,
  home: ProjectHome,
  input: EventProjectInput,
) {
  const category = await providers.discord.inspectDestination(input.categoryId);
  if (
    !category.isCategory ||
    !category.canRead ||
    category.audienceFingerprint !== input.audienceFingerprint
  )
    return null;
  const forum = await providers.discord.inspectDestination(home.destination.channelId);
  if (
    forum.destination.kind !== 'forum' ||
    forum.destination.parentId !== input.categoryId ||
    !forum.canRead ||
    !forum.canSend ||
    forum.archived ||
    forum.locked ||
    forum.audienceFingerprint !== home.audienceFingerprint ||
    forum.audienceFingerprint !== input.audienceFingerprint
  )
    return null;
  return forum;
}

/** Resolve only one explicitly related project and an already-approved matching forum. */
export async function resolveEventProjectForum(
  db: Db,
  providers: WorkProviders,
  scope: WorkScope,
  input: EventProjectInput,
): Promise<ProjectResolution> {
  const project = await relatedProject(providers, input);
  if ('error' in project) return unavailable(project.error);
  const { projectId } = project;
  const home = await findProjectHome(db, scope, input.projectSourceId, projectId);
  if (home?.destination.kind !== 'forum' || home.destination.parentId !== input.categoryId)
    return unavailable('project_forum_unavailable');
  const forum = await approvedForum(providers, home, input);
  if (!forum) return unavailable('audience_or_permission_changed');
  const choice = home.eventForumTags;
  const tagIds =
    choice?.forumId === home.destination.channelId && Array.isArray(choice.tagIds)
      ? choice.tagIds
      : [];
  if (
    !input.ignoreTags &&
    ((forum.requiredTag && !tagIds.length) ||
      tagIds.some((id) => !forum.tags.some((tag) => tag.id === id)))
  )
    return unavailable('forum_tag_required');
  return { kind: 'ready', projectId, forumId: home.destination.channelId, tagIds };
}
