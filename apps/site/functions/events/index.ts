/// <reference types="@cloudflare/workers-types" />

import { builtPage, finishPage } from '../_page-response';
import { renderEventsIndexBody, renderEventsUnavailable } from '../../src/lib/events-render';
import {
  eventCacheControl,
  loadSiteEvents,
  withAnonymousResponseCache,
  type EventsEnv,
} from './_shared';

export const onRequestGet: PagesFunction<EventsEnv> = async ({ env, request }) =>
  withAnonymousResponseCache(request, async () => {
    const [page, result] = await Promise.all([
      builtPage(env, request, '/events/'),
      loadSiteEvents(env),
    ]);

    const html = result.ok ? renderEventsIndexBody(result.entries) : renderEventsUnavailable();
    const status = result.ok ? 200 : 503;
    const cacheControl = result.ok ? eventCacheControl(request) : 'no-store';

    const rewritten = new HTMLRewriter()
      .on('[data-slot="events-body"]', {
        element(element) {
          element.setInnerContent(html, { html: true });
        },
      })
      .transform(page);

    return finishPage(rewritten, status, {}, cacheControl);
  });
