/**
 * Turn plain article text into Notion paragraph blocks.
 *
 * Notion caps a single rich_text content string at 2000 characters, so long
 * paragraphs are split at sentence boundaries. Shared by the `add:transit-news`
 * script and the Cloudflare intake function so block-building lives in one place.
 */

const NOTION_RICH_TEXT_LIMIT = 2000;

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

  return chunks.map((content) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content } }] },
  }));
}
