/// <reference types="@cloudflare/workers-types" />

// /account/delete/code: enter the code and delete the account. The member is
// signed out and sees the deleted confirmation.

import { deleteAccount } from '../../../../platform/account-data';
import { t } from '../../../../platform/messages';
import { clearedSessionCookies } from '../../../../platform/sign-in';
import { redirect, showEmailText, showText } from '../../../join/_page';
import { appendCookies, fieldError, type SignInPagesEnv } from '../../../sign-in/_shared';
import { accountPage, field, formOf, signedIn } from '../../_account';

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const email = signed.person.email ?? '';
  return accountPage(env, request, '/account/delete/code/', {
    fill: (rewriter) =>
      rewriter.on('[data-slot="sent-to"]', showEmailText(t('account.deleteCodeBody', { email }))),
  });
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const email = signed.person.email ?? '';
  const code = field(await formOf(request), 'code').replaceAll(/\D/g, '');
  const outcome =
    code.length === 6
      ? await deleteAccount(signed.env, signed.person, code)
      : ({ kind: 'short' } as const);
  if (outcome.kind === 'ok') {
    return redirect('/account/deleted/', appendCookies(new Headers(), clearedSessionCookies()));
  }
  return accountPage(env, request, '/account/delete/code/', {
    fill: (rewriter) => {
      const withIntro = rewriter.on(
        '[data-slot="sent-to"]',
        showEmailText(t('account.deleteCodeBody', { email })),
      );
      switch (outcome.kind) {
        case 'short':
          return fieldError(withIntro, 'code', t('signIn.codeError'));
        case 'wrong':
          return fieldError(withIntro, 'code', t('signIn.wrongCode', { count: outcome.triesLeft }));
        case 'too_many':
          return withIntro.on('[data-slot="notice"]', showText(t('signIn.tooMany')));
        case 'expired':
        case 'taken':
          return withIntro.on('[data-slot="notice"]', showText(t('signIn.expired')));
      }
    },
    status: 400,
  });
};
