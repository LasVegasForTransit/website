import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import { notionObject, notionProperty, type NotionTaskReadOptions } from './notion-task-types';

export async function propertyValues(
  client: NotionTaskClient,
  pageId: string,
  propertyId: string,
  type: 'people' | 'relation',
): Promise<unknown[]> {
  const values: unknown[] = [],
    cursors = new Set<string>();
  let cursor: string | null = null;
  for (let count = 0; count < 10; count++) {
    const page = await client.readProperty(pageId, propertyId, cursor);
    for (const item of page.results) {
      const row = notionObject(item);
      if (row.type !== type || typeof notionObject(row[type]).id !== 'string')
        throw new NotionTaskApiError('incomplete_property');
      values.push(row[type]);
    }
    cursor = page.nextCursor;
    if (cursor === null) return values;
    if (cursors.has(cursor)) throw new NotionTaskApiError('repeated_cursor');
    cursors.add(cursor);
  }
  throw new NotionTaskApiError('property_budget_exceeded');
}
/** Retrieve full assignment and relation properties before treating a page as eligible. */
export async function hydrateNotionTask(
  client: NotionTaskClient,
  page: unknown,
  options: NotionTaskReadOptions,
): Promise<{ page: unknown; options: NotionTaskReadOptions }> {
  const row = notionObject(page),
    properties = { ...notionObject(row.properties) };
  const hydrated = new Set<string>();
  if (typeof row.id !== 'string') throw new NotionTaskApiError('malformed_task');
  for (const [key, type] of [
    [options.fields.assignee, 'people'],
    [options.fields.project, 'relation'],
  ] as const) {
    const prop = notionProperty(page, key),
      values = prop[type];
    if (
      prop.has_more !== true &&
      !(type === 'people' && Array.isArray(values) && values.length >= 25)
    )
      continue;
    if (typeof prop.id !== 'string') throw new NotionTaskApiError('incomplete_property');
    const actualKey = Object.keys(properties).find(
      (name) => name === key || notionObject(properties[name]).id === key,
    );
    if (!actualKey) throw new NotionTaskApiError('incomplete_property');
    properties[actualKey] = {
      ...prop,
      [type]: await propertyValues(client, row.id, prop.id, type),
      has_more: false,
    };
    hydrated.add(key);
  }
  return { page: { ...row, properties }, options: { ...options, hydratedProperties: hydrated } };
}
