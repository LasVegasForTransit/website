/// <reference types="@cloudflare/workers-types" />

// /account: everything LVBT holds about the signed-in member, with a way to
// change each part. Sends a signed-out visitor to sign in and back.

import { accountView } from '../../platform/account';
import { formatPhone } from '../../platform/core/join-form';
import { formatFullDate, t } from '../../platform/messages';
import { show, showEmailText, showText } from '../join/_page';
import type { SignInPagesEnv } from '../sign-in/_shared';
import { accountPage, signedIn, takeNotice } from './_account';

// The notices a redirect can leave for this page, by the id in the cookie.
const NOTICES: Record<string, () => string> = {
  signed_in: () => t('signIn.signedIn'),
  name: () => t('account.updated.name'),
  phone: () => t('account.updated.phone'),
  email: () => t('account.updated.email'),
  area: () => t('account.updated.area'),
  area_placed: () => t('account.updated.areaPlaced'),
  left: () => t('account.updated.left'),
  rejoined: () => t('account.updated.rejoined'),
  unavailable: () => t('account.unavailable'),
};

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const view = await accountView(signed.env.PLATFORM_DB, signed.person.id);
  if (!view) return new Response(null, { status: 303, headers: { Location: '/sign-in/' } });
  const { person } = view;
  const notice = takeNotice(request);
  const name = [person.given_name, person.family_name].filter(Boolean).join(' ');

  return accountPage(env, request, '/account/', {
    fill: (rewriter) => {
      let filled = rewriter;
      if (person.given_name) {
        filled = filled.on(
          '[data-slot="greeting"]',
          showText(t('account.greetingNamed', { name: person.given_name })),
        );
      }
      if (name) filled = filled.on('[data-slot="name"]', showText(name));
      if (person.email) filled = filled.on('[data-slot="email"]', showEmailText(person.email));
      if (person.phone) {
        filled = filled.on('[data-slot="phone"]', showText(formatPhone(person.phone)));
      }
      if (view.area) filled = filled.on('[data-slot="area"]', showText(view.area));
      if (view.onMailingList && view.memberSince) {
        filled = filled
          .on(
            '[data-slot="member-since"]',
            showText(
              t('account.memberSince', { date: formatFullDate(new Date(view.memberSince)) }),
            ),
          )
          .on('[data-slot="mailing-list"]', show());
      } else {
        filled = filled.on('[data-slot="rejoin"]', show());
      }
      const text =
        notice.key && Object.hasOwn(NOTICES, notice.key) ? NOTICES[notice.key]() : undefined;
      if (text) filled = filled.on('[data-slot="notice"]', showText(text));
      return filled;
    },
    status: 200,
    headers: notice.clear,
  });
};
