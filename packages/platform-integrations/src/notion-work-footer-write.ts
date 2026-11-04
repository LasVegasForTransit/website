import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import { notionObject } from './notion-task-types';

export async function appendManagedFooter(
  client: NotionTaskClient,
  pageId: string,
  url: string,
): Promise<string[]> {
  const response = notionObject(
    await client.appendBlockChildren(pageId, [
      { object: 'block', type: 'divider', divider: {} },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { type: 'text', text: { content: 'Open the Discord conversation', link: { url } } },
          ],
        },
      },
    ]),
  );
  if (!Array.isArray(response.results) || response.results.length !== 2)
    throw new NotionTaskApiError('unconfirmed_footer', 60_000, false, true);
  const ids = response.results
    .map((value) => notionObject(value).id)
    .filter((id): id is string => typeof id === 'string');
  if (ids.length !== 2) throw new NotionTaskApiError('unconfirmed_footer', 60_000, false, true);
  return ids;
}
