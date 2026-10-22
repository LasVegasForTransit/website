import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import { propertyValues } from './notion-task-hydrate';
import { notionObject, notionProperty, type NotionTaskReadOptions } from './notion-task-types';

type ProjectCache = Map<string, Promise<string[] | null>>;
export async function readNotionProjectLeads(
  client: NotionTaskClient,
  projectId: string,
  sourceId: string,
  leadField: string,
): Promise<string[] | null> {
  try {
    const page = notionObject(await client.readPage(projectId)),
      parent = notionObject(page.parent);
    if (
      page.object !== 'page' ||
      page.id !== projectId ||
      page.archived === true ||
      page.in_trash === true ||
      typeof parent.data_source_id !== 'string' ||
      parent.data_source_id.replaceAll('-', '') !== sourceId.replaceAll('-', '')
    )
      return null;
    const property = notionProperty(page, leadField);
    let values: unknown[];
    if (!Array.isArray(property.people)) return null;
    if (property.people.length >= 25) {
      if (typeof property.id !== 'string') return null;
      values = await propertyValues(client, projectId, property.id, 'people');
    } else values = property.people as unknown[];
    const leads = values.map((value) => notionObject(value).id);
    return leads.every((lead) => typeof lead === 'string' && lead.length > 0)
      ? (leads as string[])
      : null;
  } catch (error) {
    if (error instanceof NotionTaskApiError && ['http_403', 'http_404'].includes(error.code))
      return null;
    throw error;
  }
}
export async function resolveNotionTaskEscalation(
  client: NotionTaskClient,
  projects: string[],
  options: NotionTaskReadOptions,
  cache: ProjectCache,
) {
  const ids = new Set<string>();
  let needsReview = !projects.length || !options.projectsSourceId || !options.projectLeadField;
  if (options.projectsSourceId && options.projectLeadField)
    for (const project of projects) {
      let pending = cache.get(project);
      if (!pending) {
        pending = readNotionProjectLeads(
          client,
          project,
          options.projectsSourceId,
          options.projectLeadField,
        );
        cache.set(project, pending);
      }
      const leads = await pending;
      if (!leads?.length) needsReview = true;
      else for (const lead of leads) ids.add(lead);
    }
  return { escalationNotionIds: [...ids].sort(), escalationNeedsReview: needsReview };
}
