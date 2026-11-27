/// <reference types="@cloudflare/workers-types" />

import { builtPage, finishPage } from '../../_page-response';
import type { EventsEnv } from '../_shared';

/** Keep internal prebuilt event body fragments hidden behind direct Worker requests. */
export const onRequestGet: PagesFunction<EventsEnv> = async ({ env, request }) => {
  const page = await builtPage(env, request, '/404.html');
  return finishPage(page, 404, {}, 'no-store');
};
