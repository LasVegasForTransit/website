/// <reference types="@cloudflare/workers-types" />

// /account/mailing-list: GET asks before leaving; POST leaves or rejoins.

import { leaveMailingList, rejoinMailingList } from '../../../platform/account';
import type { SignInPagesEnv } from '../../sign-in/_shared';
import { accountPage, backToAccount, field, formOf, signedIn } from '../_account';
import { redirect } from '../../join/_page';

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  return accountPage(env, request, '/account/mailing-list/');
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const action = field(await formOf(request), 'action');
  if (action === 'leave') {
    await leaveMailingList(signed.env, signed.person.id);
    return backToAccount('left');
  }
  if (action === 'rejoin') {
    const outcome = await rejoinMailingList(signed.env, signed.person);
    return backToAccount(outcome === 'rejoined' ? 'rejoined' : 'unavailable');
  }
  return redirect('/account/');
};
