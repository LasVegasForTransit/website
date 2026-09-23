/// <reference types="@cloudflare/workers-types" />

// /join/member: the join form. GET serves the built form with a fresh
// one-time token. POST joins the visitor, or serves the form again with their
// input and the errors. The newsletter box posts here too, as JSON when its
// script runs and as an ordinary form when it doesn't.

import { ulid } from '../../../platform/core/ids';
import { readJoinForm } from '../../../platform/core/join-form';
import { processJoin, type JoinOutcome } from '../../../platform/join';
import { t } from '../../../platform/messages';
import { renderJoinForm, type FormState } from '../_form';
import { joinStepCookie, platformEnv, redirect, wantsJson, type JoinEnv } from '../_page';

const FORM_PATH = '/join/member/';

function renderForm(
  env: JoinEnv,
  request: Request,
  state: FormState,
  status: number,
): Promise<Response> {
  return renderJoinForm(env, request, { ...state, path: FORM_PATH }, status);
}

function jsonOutcome(outcome: JoinOutcome): Response {
  const status =
    outcome.kind === 'invalid'
      ? 400
      : outcome.kind === 'rate_limited'
        ? 429
        : outcome.kind === 'unavailable'
          ? 503
          : 200;
  const body =
    outcome.kind === 'invalid'
      ? { status: outcome.kind, errors: outcome.errors }
      : { status: outcome.kind === 'discarded' ? 'joined' : outcome.kind };
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const onRequestGet: PagesFunction<JoinEnv> = async ({ env, request }) =>
  renderForm(env, request, { formToken: ulid() }, 200);

export const onRequestPost: PagesFunction<JoinEnv> = async ({ env, request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return renderForm(env, request, { formToken: ulid() }, 400);
  }
  const input = readJoinForm(form);
  const formToken = input.formToken || ulid();
  const platform = platformEnv(env);

  const outcome: JoinOutcome = platform
    ? await processJoin(platform, input, request.headers.get('CF-Connecting-IP') ?? 'unknown')
    : { kind: 'unavailable' };

  if (wantsJson(request)) return jsonOutcome(outcome);

  switch (outcome.kind) {
    case 'discarded':
      return redirect('/join/member/welcome/');
    case 'rate_limited':
      return renderForm(env, request, { formToken, input, notice: t('join.rateLimited') }, 429);
    case 'invalid':
      return renderForm(env, request, { formToken, input, errors: outcome.errors }, 400);
    case 'unavailable':
      return renderForm(env, request, { formToken, input, notice: t('join.unavailable') }, 503);
    case 'joined': {
      const cookie = await joinStepCookie(platform?.LVBT_LINK_SIGNING_SECRET ?? '', {
        personId: outcome.personId,
        givenName: outcome.givenName,
        email: outcome.email,
        address: outcome.address,
      });
      const next = outcome.needsRegion ? '/join/member/region/' : '/join/member/welcome/';
      return redirect(next, { 'Set-Cookie': cookie });
    }
  }
};
