/// <reference types="@cloudflare/workers-types" />

// /account/email: step one of changing your email. POST sends a code to the
// new address; nothing changes until it is entered.

import { startEmailChange } from '../../../platform/account';
import { t } from '../../../platform/messages';
import { redirect, showText } from '../../join/_page';
import { fieldError, setValue, type SignInPagesEnv } from '../../sign-in/_shared';
import { accountPage, callerAddress, field, formOf, signedIn } from '../_account';

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  return accountPage(env, request, '/account/email/');
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const email = field(await formOf(request), 'email')
    .trim()
    .slice(0, 254);
  const outcome = await startEmailChange(signed.env, signed.person, {
    email,
    callerAddress: callerAddress(request),
  });
  if (outcome.kind === 'sent') return redirect('/account/email/code/');
  return accountPage(env, request, '/account/email/', {
    fill: (rewriter) => {
      const kept = rewriter.on('input[name="email"]', setValue(email));
      switch (outcome.kind) {
        case 'invalid':
          return fieldError(kept, 'email');
        case 'same':
          return kept.on('[data-slot="notice"]', showText(t('account.emailSame')));
        case 'taken':
          return kept.on('[data-slot="notice"]', showText(t('account.emailTaken')));
        case 'rate_limited':
          return kept.on(
            '[data-slot="notice"]',
            showText(t('signIn.rateLimited', { time: outcome.retryAfter })),
          );
      }
    },
    status: 400,
  });
};
