/// <reference types="@cloudflare/workers-types" />

// /account/email/code: step two of changing your email. The code sent to the
// new address confirms it, and the old address gets a notice.

import { confirmEmailChange } from '../../../../platform/account';
import { pendingNewEmail } from '../../../../platform/auth';
import { t } from '../../../../platform/messages';
import { redirect, showEmailText, showText } from '../../../join/_page';
import { fieldError, type SignInPagesEnv } from '../../../sign-in/_shared';
import { accountPage, backToAccount, field, formOf, signedIn } from '../../_account';

function sentTo(email: string) {
  return showEmailText(t('account.emailCodeBody', { email }));
}

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const email = await pendingNewEmail(signed.env, signed.person.id);
  if (!email) return redirect('/account/email/');
  return accountPage(env, request, '/account/email/code/', {
    fill: (rewriter) => rewriter.on('[data-slot="intro"]', sentTo(email)),
  });
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const email = await pendingNewEmail(signed.env, signed.person.id);
  const code = field(await formOf(request), 'code').replaceAll(/\D/g, '');
  const outcome =
    code.length === 6
      ? await confirmEmailChange(signed.env, signed.person, code)
      : ({ kind: 'short' } as const);
  if (outcome.kind === 'ok') return backToAccount('email');
  return accountPage(env, request, '/account/email/code/', {
    fill: (rewriter) => {
      const withIntro = email ? rewriter.on('[data-slot="intro"]', sentTo(email)) : rewriter;
      switch (outcome.kind) {
        case 'short':
          return fieldError(withIntro, 'code', t('signIn.codeError'));
        case 'wrong':
          return fieldError(withIntro, 'code', t('signIn.wrongCode', { count: outcome.triesLeft }));
        case 'too_many':
          return withIntro.on('[data-slot="notice"]', showText(t('signIn.tooMany')));
        case 'expired':
          return withIntro.on('[data-slot="notice"]', showText(t('signIn.expired')));
        case 'taken':
          return withIntro.on('[data-slot="notice"]', showText(t('account.emailTaken')));
      }
    },
    status: 400,
  });
};
