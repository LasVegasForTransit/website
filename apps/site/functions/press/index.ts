/// <reference types="@cloudflare/workers-types" />

import { builtPage, finishPage } from '../_page-response';
import { loadPressEntries, renderPressEntries } from './_content';

interface PressEnv {
  ASSETS: Fetcher;
  LVBT_NOTION_API_KEY?: string;
  LVBT_PRESS_DATA_SOURCE_ID?: string;
}

const UNAVAILABLE =
  '<li class="border-b border-outline-variant/25 py-8 md:py-10"><p class="text-body-lg">Press coverage could not be loaded right now. Please check back soon.</p></li>';

export const onRequestGet: PagesFunction<PressEnv> = async ({ env, request }) => {
  const page = await builtPage(env, request, '/press/');
  let markup = UNAVAILABLE;

  if (env.LVBT_NOTION_API_KEY && env.LVBT_PRESS_DATA_SOURCE_ID) {
    try {
      // Cloudflare adds `default` to CacheStorage; Astro's DOM typings omit it.
      const cache = (caches as CacheStorage & { default: Cache }).default;
      const entries = await loadPressEntries({
        token: env.LVBT_NOTION_API_KEY,
        dataSourceId: env.LVBT_PRESS_DATA_SOURCE_ID,
        requestUrl: request.url,
        cache,
      });
      markup = renderPressEntries(entries);
    } catch (error) {
      console.error(`press: Notion coverage query failed: ${String(error)}`);
    }
  } else {
    console.error('press: Notion API key or press data source ID is missing');
  }

  const response = new HTMLRewriter()
    .on('[data-slot="press-coverage"]', {
      element(element) {
        element.setInnerContent(markup, { html: true });
      },
    })
    .transform(page);
  return finishPage(response, page.status);
};
