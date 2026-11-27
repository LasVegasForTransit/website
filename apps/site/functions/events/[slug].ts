/// <reference types="@cloudflare/workers-types" />

import { buildIcs } from '../../src/lib/event-ics';
import { EVENT_LEGACY_REDIRECTS } from '../../src/lib/event-legacy-redirects';
import { resolveEventBySlug } from '../../src/lib/events-live';
import {
  renderEventDetail,
  renderEventRemoved,
  renderEventsUnavailable,
} from '../../src/lib/events-render';
import { eventMetaDescription, eventMetaTitle } from '../../src/lib/event-seo';
import { canonicalUrl } from '../../src/lib/paths';
import { eventSchema } from '../../src/lib/structured-data';
import { builtPage, finishPage, SECURITY_HEADERS } from '../_page-response';
import {
  eventCacheControl,
  loadMdxOverrideHtml,
  loadSiteEvents,
  rewriteShellMeta,
  withAnonymousResponseCache,
  type EventsEnv,
} from './_shared';

async function notFoundResponse(env: EventsEnv, request: Request): Promise<Response> {
  const page = await builtPage(env, request, '/404.html');
  return finishPage(page, 404, {}, 'no-store');
}

function redirectResponse(location: string, cacheControl: string): Response {
  return new Response(null, {
    status: 301,
    headers: {
      ...SECURITY_HEADERS,
      Location: location,
      'Cache-Control': cacheControl,
    },
  });
}

async function unavailableResponse(env: EventsEnv, request: Request): Promise<Response> {
  const shell = await builtPage(env, request, '/events/shell/');
  const rewritten = rewriteShellMeta(shell, {
    title: 'Events',
    description: 'Upcoming LVBT meetings, walks, teach-ins, and organizing actions.',
    canonical: canonicalUrl(new URL(request.url).pathname),
    noindex: true,
    detailHtml: `<div class="container-page py-12 md:py-16">${renderEventsUnavailable()}</div>`,
  });
  return finishPage(rewritten, 503, { 'X-Robots-Tag': 'noindex, nofollow' }, 'no-store');
}

async function removedResponse(env: EventsEnv, request: Request): Promise<Response> {
  const shell = await builtPage(env, request, '/events/shell/');
  const rewritten = rewriteShellMeta(shell, {
    title: 'Event no longer scheduled',
    description: "This event is no longer on LVBT's calendar.",
    canonical: canonicalUrl('/events/'),
    noindex: true,
    detailHtml: renderEventRemoved(),
  });
  return finishPage(rewritten, 410, { 'X-Robots-Tag': 'noindex, nofollow' }, 'no-store');
}

async function handleIcsRequest(
  env: EventsEnv,
  request: Request,
  segment: string,
  cacheControl: string,
): Promise<Response> {
  const slug = segment.slice(0, -'.ics'.length);
  const legacyTarget = EVENT_LEGACY_REDIRECTS[slug];
  if (legacyTarget) {
    const targetSlug = legacyTarget.replace(/^\/events\//, '').replace(/\/$/, '');
    return redirectResponse(`/events/${targetSlug}.ics`, cacheControl);
  }

  const result = await loadSiteEvents(env);
  if (!result.ok) {
    return new Response('Calendar feed temporarily unavailable.', {
      status: 503,
      headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' },
    });
  }

  const resolution = await resolveEventBySlug(env.PLATFORM_DB, result.entries, slug);
  if (resolution.kind === 'redirect') {
    return redirectResponse(`/events/${resolution.toSlug}.ics`, cacheControl);
  }
  if (resolution.kind === 'removed') {
    return new Response("This event is no longer on LVBT's calendar.", {
      status: 410,
      headers: {
        ...SECURITY_HEADERS,
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'no-store',
      },
    });
  }
  if (resolution.kind === 'not_found') return notFoundResponse(env, request);

  const ics = buildIcs({ id: resolution.entry.slug, data: resolution.entry.data });
  return new Response(ics, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${resolution.entry.slug}.ics"`,
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': cacheControl,
    },
  });
}

async function handleEventPageRequest(
  env: EventsEnv,
  request: Request,
  segment: string,
  cacheControl: string,
): Promise<Response> {
  const legacyTarget = EVENT_LEGACY_REDIRECTS[segment];
  if (legacyTarget) return redirectResponse(legacyTarget, cacheControl);

  const result = await loadSiteEvents(env);
  if (!result.ok) return unavailableResponse(env, request);

  const resolution = await resolveEventBySlug(env.PLATFORM_DB, result.entries, segment);
  if (resolution.kind === 'redirect')
    return redirectResponse(`/events/${resolution.toSlug}/`, cacheControl);
  if (resolution.kind === 'removed') return removedResponse(env, request);
  if (resolution.kind === 'not_found') return notFoundResponse(env, request);

  if (!new URL(request.url).pathname.endsWith('/')) {
    return redirectResponse(`/events/${resolution.entry.slug}/`, cacheControl);
  }

  const canonical = canonicalUrl(`/events/${resolution.entry.slug}/`);
  const [shell, mdxBody] = await Promise.all([
    builtPage(env, request, '/events/shell/'),
    loadMdxOverrideHtml(env, request, resolution.entry),
  ]);
  const entry = { id: resolution.entry.slug, data: resolution.entry.data };
  const rewritten = rewriteShellMeta(shell, {
    title: eventMetaTitle(entry),
    description: eventMetaDescription(entry),
    canonical,
    schemaJson: JSON.stringify(eventSchema(entry, canonical)),
    detailHtml: renderEventDetail(
      resolution.entry,
      mdxBody ?? resolution.entry.data.body ?? null,
      canonical,
    ),
  });

  return finishPage(rewritten, 200, {}, cacheControl);
}

export const onRequestGet: PagesFunction<EventsEnv> = async ({ env, request, params }) =>
  withAnonymousResponseCache(request, async () => {
    const rawSlug = params.slug;
    const segment = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
    if (!segment || segment === 'shell' || segment === 'bodies') {
      return notFoundResponse(env, request);
    }

    const cacheControl = eventCacheControl(request);
    if (segment.endsWith('.ics')) {
      return handleIcsRequest(env, request, segment, cacheControl);
    }
    return handleEventPageRequest(env, request, segment, cacheControl);
  });
