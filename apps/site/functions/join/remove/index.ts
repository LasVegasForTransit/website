/// <reference types="@cloudflare/workers-types" />

// /join/remove/?token=…: the "Not you? Remove this email" link. GET only
// shows a button, because email security scanners open links automatically;
// POST removes the email.

import { t } from '../../../platform/messages';
import { checkRemovalToken, removeEmail } from '../../../platform/remove';
import {
  builtPage,
  finish,
  platformEnv,
  show,
  showEmailText,
  showText,
  type JoinEnv,
} from '../_page';

const PAGE = '/join/remove/';

async function result(env: JoinEnv, request: Request, text: string): Promise<Response> {
  const page = await builtPage(env, request, PAGE);
  return finish(new HTMLRewriter().on('[data-slot="result"]', showText(text)).transform(page), 200);
}

export const onRequestGet: PagesFunction<JoinEnv> = async ({ env, request }) => {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const platform = platformEnv(env);
  const check =
    platform && token ? await checkRemovalToken(platform, token) : { kind: 'invalid' as const };
  if (check.kind === 'invalid') return result(env, request, t('remove.invalid'));

  const page = await builtPage(env, request, PAGE);
  const rewriter = new HTMLRewriter()
    .on('[data-slot="body"]', showEmailText(t('remove.body', { email: check.email })))
    .on('[data-slot="remove-form"]', show())
    .on('[data-slot="token"]', {
      element(element) {
        element.setAttribute('value', token);
      },
    });
  return finish(rewriter.transform(page), 200);
};

export const onRequestPost: PagesFunction<JoinEnv> = async ({ env, request }) => {
  const form = await request.formData().catch(() => new FormData());
  const token = form.get('token');
  const platform = platformEnv(env);
  if (!platform || typeof token !== 'string' || !token) {
    return result(env, request, t('remove.invalid'));
  }
  const outcome = await removeEmail(platform, token);
  return result(env, request, outcome === 'removed' ? t('remove.done') : t('remove.invalid'));
};
