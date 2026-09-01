/**
 * Notion block helpers and the API limits that shape them.
 *
 * Notion caps a single rich_text content string at 2000 characters and a page
 * create at 100 child blocks. Shared by the `add:transit-news` script and the
 * Cloudflare intake functions so block-building lives in one place.
 */

export const NOTION_RICH_TEXT_LIMIT = 2000;
export const NOTION_CHILDREN_LIMIT = 100;

/** Truncate to the rich_text limit, marking the cut with an ellipsis. */
export function clampToNotionLimit(content: string): string {
  if (content.length <= NOTION_RICH_TEXT_LIMIT) return content;
  return `${content.slice(0, NOTION_RICH_TEXT_LIMIT - 1)}…`;
}

export function paragraphBlock(content: string) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content } }] },
  };
}

/** Split long article text into paragraph blocks at sentence boundaries. */
export function makeParagraphBlocks(text: string): unknown[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const para of paragraphs) {
    let remaining = para;
    while (remaining.length > NOTION_RICH_TEXT_LIMIT) {
      const split = remaining.lastIndexOf('. ', NOTION_RICH_TEXT_LIMIT);
      const cutAt = split > 0 ? split + 1 : NOTION_RICH_TEXT_LIMIT;
      chunks.push(remaining.slice(0, cutAt).trim());
      remaining = remaining.slice(cutAt).trim();
    }
    if (remaining) chunks.push(remaining);
  }

  return chunks.map(paragraphBlock);
}
