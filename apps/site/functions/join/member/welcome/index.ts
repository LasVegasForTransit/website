/// <reference types="@cloudflare/workers-types" />

// /join/member/welcome: "You're in." Shows only what this browser just
// submitted, read from the signed join-step cookie.

import { t } from '../../../../platform/messages';
import {
  builtPage,
  finish,
  platformEnv,
  readJoinStep,
  showEmailText,
  showText,
  type JoinEnv,
} from '../../_page';

export const onRequestGet: PagesFunction<JoinEnv> = async ({ env, request }) => {
  const page = await builtPage(env, request, '/join/member/welcome/');
  const platform = platformEnv(env);
  const step = platform ? await readJoinStep(platform.LVBT_LINK_SIGNING_SECRET, request) : null;
  if (!step) return finish(page, 200);

  let rewriter = new HTMLRewriter();
  if (step.givenName) {
    rewriter = rewriter.on(
      '[data-slot="heading"]',
      showText(t('welcome.headingNamed', { name: step.givenName })),
    );
  }
  if (step.email) {
    rewriter = rewriter.on(
      '[data-slot="sent-to"]',
      showEmailText(t('welcome.sentTo', { email: step.email })),
    );
  }
  if (step.address === 'not_placed') {
    rewriter = rewriter.on('[data-slot="address-notice"]', showText(t('welcome.addressNotPlaced')));
  } else if (step.address === 'unavailable') {
    rewriter = rewriter.on(
      '[data-slot="address-notice"]',
      showText(t('welcome.addressUnavailable')),
    );
  }
  return finish(rewriter.transform(page), 200);
};
