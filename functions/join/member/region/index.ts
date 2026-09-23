/// <reference types="@cloudflare/workers-types" />

// /join/member/region: "Which part of the valley do you live in?", reachable
// only right after joining in this browser. The answer is saved with source
// `member_choice`; "I'd rather not say" saves nothing.

import { isRegionId } from '../../../../platform/core/regions';
import { PersonService } from '../../../../platform/storage/person-service';
import { builtPage, finish, platformEnv, readJoinStep, redirect, type JoinEnv } from '../../_page';

// Without this browser's join step there is nothing to ask: the person is
// already a member, so send them on to the welcome page.
const expired = () => redirect('/join/member/welcome/');

export const onRequestGet: PagesFunction<JoinEnv> = async ({ env, request }) => {
  const platform = platformEnv(env);
  const step = platform ? await readJoinStep(platform.LVBT_LINK_SIGNING_SECRET, request) : null;
  if (!step) return expired();
  return finish(await builtPage(env, request, '/join/member/region/'), 200);
};

export const onRequestPost: PagesFunction<JoinEnv> = async ({ env, request }) => {
  const platform = platformEnv(env);
  const step = platform ? await readJoinStep(platform.LVBT_LINK_SIGNING_SECRET, request) : null;
  if (!platform || !step) return expired();
  const form = await request.formData().catch(() => new FormData());
  const choice = form.get('region');
  if (typeof choice === 'string' && isRegionId(choice)) {
    await new PersonService(platform.PLATFORM_DB).setRegion(step.personId, choice, 'member_choice');
  }
  return redirect('/join/member/welcome/');
};
