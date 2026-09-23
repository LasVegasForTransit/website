/// <reference types="@cloudflare/workers-types" />

// /account/phone: change or remove your phone number.

import { updatePhone } from '../../../platform/account';
import { formatPhone } from '../../../platform/core/join-form';
import { PersonService } from '../../../platform/storage/person-service';
import { fieldError, setValue, type SignInPagesEnv } from '../../sign-in/_shared';
import { accountPage, backToAccount, field, formOf, signedIn } from '../_account';

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const person = await new PersonService(signed.env.PLATFORM_DB).getPerson(signed.person.id);
  return accountPage(env, request, '/account/phone/', {
    fill: (rewriter) =>
      rewriter.on('input[name="phone"]', setValue(person?.phone ? formatPhone(person.phone) : '')),
  });
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const phone = field(await formOf(request), 'phone').slice(0, 40);
  const outcome = await updatePhone(signed.env.PLATFORM_DB, signed.person.id, phone);
  if (outcome === 'updated') return backToAccount('phone');
  return accountPage(env, request, '/account/phone/', {
    fill: (rewriter) => fieldError(rewriter.on('input[name="phone"]', setValue(phone)), 'phone'),
    status: 400,
  });
};
