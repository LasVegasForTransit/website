// Custom Astro content-collection loader. Fetches the Beehiiv newsletter RSS
// feed at build, parses each <item>, and emits entries that satisfy the
// `newsletter` collection schema in src/content.config.ts.
//
// Unlike the events loader, an EMPTY feed is not an error: the newsletter may
// not have published its first issue yet, or PUBLIC_LVBT_NEWSLETTER_FEED_URL
// may be unset (e.g. local dev without .env.local). In both cases we emit zero
// entries; the /newsletter page renders an empty state. We only fail the build
// when a configured feed can't be fetched (network failure worth surfacing
// loudly).
//
// The site does not host issues — each entry's `link` points at the Beehiiv
// post. The feed re-pulls on the existing twice-daily production rebuild
// (.github/workflows/cron-rebuild.yml), so new issues appear within ~12h.

import type { Loader } from 'astro/loaders';
import { XMLParser } from 'fast-xml-parser';
import { site } from './site';
import { truncate } from './truncate';

type NewsletterData = {
  title: string;
  link: string;
  pubDate: Date;
  excerpt: string;
  image?: string;
};

const EXCERPT_MAX = 220;

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

// fast-xml-parser leaves an element as a plain string when it has no
// attributes, or as `{ '#text': '…', '@_attr': '…' }` when it does (e.g. a
// <guid isPermaLink="false">). Normalize both to the text content.
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) {
    return String((value as Record<string, unknown>)['#text'] ?? '');
  }
  return '';
}

function attrUrl(value: unknown): string | undefined {
  if (value && typeof value === 'object' && '@_url' in value) {
    const url = (value as Record<string, unknown>)['@_url'];
    if (typeof url === 'string' && url.trim()) return url;
  }
  return undefined;
}

function buildEntry(item: Record<string, unknown>): {
  id: string;
  data: NewsletterData;
  digestInput: string;
} | null {
  const title = textOf(item.title).trim();
  const link = textOf(item.link).trim();
  if (!title || !link) return null;

  const pubRaw = textOf(item.pubDate).trim();
  const pubDate = pubRaw ? new Date(pubRaw) : new Date(NaN);
  if (Number.isNaN(pubDate.getTime())) return null;

  const rawBody = textOf(item.description) || textOf(item['content:encoded']);
  const excerpt = truncate(stripHtml(rawBody), EXCERPT_MAX) || title;

  // Thumbnail: Beehiiv usually exposes one via <enclosure> or <media:content>.
  const image = attrUrl(item.enclosure) ?? attrUrl(item['media:content']);

  // Prefer guid as the stable id; fall back to the post URL.
  const id = textOf(item.guid).trim() || link;

  return {
    id,
    data: { title, link, pubDate, excerpt, image },
    digestInput: [id, title, pubRaw, link].join('|'),
  };
}

export function beehiivNewsletterLoader(): Loader {
  return {
    name: 'beehiiv-newsletter-loader',
    load: async ({ store, parseData, generateDigest, logger }) => {
      const feedUrl = site.newsletter.feedUrl;
      if (!feedUrl) {
        store.clear();
        return;
      }

      logger.info(`Fetching newsletter feed from ${feedUrl}`);
      const res = await fetch(feedUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch newsletter RSS feed: ${res.status} ${res.statusText}`);
      }
      const xml = await res.text();

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        // Force <item> to always parse as an array, even with a single item.
        isArray: (name) => name === 'item',
      });
      const parsed = parser.parse(xml) as {
        rss?: { channel?: { item?: Array<Record<string, unknown>> } };
      };

      const items = parsed.rss?.channel?.item ?? [];

      store.clear();

      if (items.length === 0) {
        logger.info('Newsletter feed has no published items yet — emitting none.');
        return;
      }

      const entries = items
        .map(buildEntry)
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

      for (const { id, data, digestInput } of entries) {
        const parsedData = await parseData({
          id,
          data: data as unknown as Record<string, unknown>,
        });
        store.set({ id, data: parsedData, digest: generateDigest(digestInput) });
      }

      logger.info(`Loaded ${entries.length} newsletter issue(s) from the feed.`);
    },
  };
}
