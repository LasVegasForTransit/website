/// <reference types="@cloudflare/workers-types" />

// /prototypes/join/: the join form prototype's handler. It checks the fields
// exactly as the real join form does and shows the next screen, but saves
// nothing and calls no outside service. On a production build the prototype
// pages don't exist, so this answers 404.

import { ulid } from '../../../platform/core/ids';
import { hasErrors, readJoinForm, validateJoin } from '../../../platform/core/join-form';
import { renderJoinForm } from '../../join/_form';
import { builtPage, redirect, type JoinEnv } from '../../join/_page';

const PAGE = '/prototypes/join/';
const ROBOTS = { 'X-Robots-Tag': 'noindex, nofollow' };

async function withRobots(response: Promise<Response>): Promise<Response> {
  const result = await response;
  const headers = new Headers(result.headers);
  headers.set('X-Robots-Tag', ROBOTS['X-Robots-Tag']);
  return new Response(result.body, { status: result.status, headers });
}

async function prototypesBuilt(env: JoinEnv, request: Request): Promise<boolean> {
  const page = await builtPage(env, request, PAGE);
  await page.body?.cancel();
  return page.ok;
}

export const onRequestGet: PagesFunction<JoinEnv> = async ({ env, request, next }) => {
  if (!(await prototypesBuilt(env, request))) return next();
  return withRobots(renderJoinForm(env, request, { formToken: ulid(), path: PAGE }, 200));
};

export const onRequestPost: PagesFunction<JoinEnv> = async ({ env, request, next }) => {
  if (!(await prototypesBuilt(env, request))) return next();
  const input = readJoinForm(await request.formData().catch(() => new FormData()));
  const errors = validateJoin(input);
  if (hasErrors(errors)) {
    return withRobots(
      renderJoinForm(
        env,
        request,
        { formToken: input.formToken || ulid(), input, errors, path: PAGE },
        400,
      ),
    );
  }
  return redirect('/prototypes/join/welcome/', ROBOTS);
};
