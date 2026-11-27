/// <reference types="@cloudflare/workers-types" />

import { SESSION_COOKIE, readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { selectEventBody } from '../../src/lib/event-bodies';
import {
  FEED_CACHE_TTL_SECONDS,
  loadLiveEvents,
  type EventCache,
  type LiveEventEntry,
} from '../../src/lib/events-live';
import { site } from '../../src/lib/site';
import { builtPage } from '../_page-response';

export interface EventsEnv {
  ASSETS: Fetcher;
  PLATFORM_DB?: D1Database;
}

interface EventBodyIndexItem {
  id: string;
  data: { calendarOccurrenceId?: string | undefined };
}

export const PUBLIC_EVENT_CACHE_CONTROL = `public, s-maxage=${FEED_CACHE_TTL_SECONDS}, stale-while-revalidate=${FEED_CACHE_TTL_SECONDS}`;

/** Signed-in sessions must never share edge-cached HTML even on public event pages. */
export function eventCacheControl(request: Request): string {
  return readCookie(request, SESSION_COOKIE) ? 'private, no-store' : PUBLIC_EVENT_CACHE_CONTROL;
}

/**
 * Reuse full 200 and 301 responses in Cloudflare's edge cache for anonymous
 * visitors so repeat hits skip `HTMLRewriter`, asset fetches, and D1 altogether.
 */
export async function withAnonymousResponseCache(
  request: Request,
  render: () => Promise<Response>,
  cacheOverride?: EventCache,
): Promise<Response> {
  if (readCookie(request, SESSION_COOKIE)) {
    return render();
  }

  const cache = cacheOverride ?? (caches as CacheStorage & { default?: EventCache }).default;
  if (!cache) return render();

  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  } catch {
    // Fall through to rendering if cache lookup fails.
  }

  const response = await render();
  if (response.status === 200 || response.status === 301) {
    try {
      await cache.put(cacheKey, response.clone());
    } catch {
      // Cache write failures never break a valid rendered response.
    }
  }
  return response;
}

export async function loadSiteEvents(env: EventsEnv) {
  const cache = (caches as CacheStorage & { default?: Cache }).default;
  return loadLiveEvents({
    icsUrl: site.calendar.icsUrl,
    db: env.PLATFORM_DB,
    cache,
  });
}

export async function loadMdxOverrideHtml(
  env: EventsEnv,
  request: Request,
  entry: LiveEventEntry,
): Promise<string | null> {
  const indexRes = await builtPage(env, request, '/events/bodies/index.json');
  if (!indexRes.ok) return null;

  let items: EventBodyIndexItem[];
  try {
    items = await indexRes.json();
  } catch {
    return null;
  }

  const match = selectEventBody(items, {
    id: entry.slug,
    data: { calendarOccurrenceId: entry.data.calendarOccurrenceId },
  });
  if (!match) return null;

  const fragmentRes = await builtPage(env, request, `/events/bodies/${match.id}/`);
  if (!fragmentRes.ok) return null;

  const html = await fragmentRes.text();
  const open = html.indexOf('<div data-slot="event-body" class="prose-doc">');
  if (open === -1) return null;
  const contentStart = html.indexOf('>', open) + 1;
  const contentEnd = html.lastIndexOf('</div>');
  if (contentEnd <= contentStart) return null;
  return html.slice(contentStart, contentEnd).trim() || null;
}

export interface ShellRewriteOptions {
  title: string;
  description: string;
  canonical: string;
  schemaJson?: string | undefined;
  noindex?: boolean | undefined;
  detailHtml: string;
}

export function rewriteShellMeta(page: Response, options: ShellRewriteOptions): Response {
  const fullTitle = `${options.title} — ${site.name}`;
  const ogMeta: Record<string, string> = {
    'og:title': fullTitle,
    'og:description': options.description,
    'og:url': options.canonical,
  };

  let rewriter = new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(fullTitle);
      },
    })
    .on('meta[name="description"]', {
      element(element) {
        element.setAttribute('content', options.description);
      },
    })
    .on('link[rel="canonical"]', {
      element(element) {
        element.setAttribute('href', options.canonical);
      },
    })
    .on('meta[property]', {
      element(element) {
        const property = element.getAttribute('property');
        if (property && Object.hasOwn(ogMeta, property)) {
          const next = ogMeta[property];
          if (next !== undefined) element.setAttribute('content', next);
        }
      },
    })
    .on('[data-slot="event-detail"]', {
      element(element) {
        element.replace(options.detailHtml, { html: true });
      },
    });

  if (options.schemaJson !== undefined) {
    const schemaJson = options.schemaJson;
    rewriter = rewriter.on('[data-slot="event-schema"]', {
      element(element) {
        element.replace(`<script type="application/ld+json">${schemaJson}</script>`, {
          html: true,
        });
      },
    });
  } else {
    rewriter = rewriter.on('[data-slot="event-schema"]', {
      element(element) {
        element.remove();
      },
    });
  }

  if (options.noindex) {
    rewriter = rewriter.on('head', {
      element(element) {
        element.append('<meta name="robots" content="noindex,nofollow">', { html: true });
      },
    });
  }

  return rewriter.transform(page);
}
