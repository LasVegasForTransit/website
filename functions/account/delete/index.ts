/// <reference types="@cloudflare/workers-types" />

// /account/delete: GET explains what deleting does; POST sends a fresh code
// to the member's email and goes to the code step.

import { sendDeleteCode } from '../../../platform/account-data';
import { t } from '../../../platform/messages';
import { redirect, show, showText } from '../../join/_page';
import type { SignInPagesEnv } from '../../sign-in/_shared';
import { accountPage, callerAddress, signedIn, type Signed } from '../_account';

async function isVolunteer(signed: Signed): Promise<boolean> {
  const row = await signed.env.PLATFORM_DB.prepare(
    "SELECT 1 AS found FROM identities WHERE person_id = ? AND platform = 'google_workspace' LIMIT 1",
  )
    .bind(signed.person.id)
    .first();
  return row !== null;
}

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const volunteer = await isVolunteer(signed);
  return accountPage(env, request, '/account/delete/', {
    fill: (rewriter) =>
      volunteer ? rewriter.on('[data-slot="volunteer-note"]', show()) : rewriter,
  });
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const outcome = await sendDeleteCode(signed.env, signed.person, callerAddress(request));
  if (outcome.kind === 'sent') return redirect('/account/delete/code/');
  const notice =
    outcome.kind === 'rate_limited'
      ? t('signIn.rateLimited', { time: outcome.retryAfter })
      : t('account.unavailable');
  return accountPage(env, request, '/account/delete/', {
    fill: (rewriter) => rewriter.on('[data-slot="notice"]', showText(notice)),
    status: 429,
  });
};
