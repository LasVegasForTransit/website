/// <reference types="@cloudflare/workers-types" />

import { resolveEventByStableId } from '../../../src/lib/events-live';
import { renderEventRemoved, renderEventsUnavailable } from '../../../src/lib/events-render';
import { canonicalUrl } from '../../../src/lib/paths';
import { builtPage, finishPage, SECURITY_HEADERS } from '../../_page-response';
import {
  eventCacheControl,
  loadSiteEvents,
  rewriteShellMeta,
  withAnonymousResponseCache,
  type EventsEnv,
} from '../_shared';

export const onRequestGet: PagesFunction<EventsEnv> = async ({ env, request, params }) =>
  withAnonymousResponseCache(request, async () => {
    const rawId = params.stableId;
    const stableId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!stableId) {
      const page = await builtPage(env, request, '/404.html');
      return finishPage(page, 404, {}, 'no-store');
    }

    const result = await loadSiteEvents(env);
    if (!result.ok) {
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

    const resolution = await resolveEventByStableId(env.PLATFORM_DB, result.entries, stableId);
    if (resolution.kind === 'redirect') {
      return new Response(null, {
        status: 301,
        headers: {
          ...SECURITY_HEADERS,
          Location: `/events/${resolution.toSlug}/`,
          'Cache-Control': eventCacheControl(request),
        },
      });
    }

    if (resolution.kind === 'removed') {
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

    const page = await builtPage(env, request, '/404.html');
    return finishPage(page, 404, {}, 'no-store');
  });
