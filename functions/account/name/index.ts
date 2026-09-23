/// <reference types="@cloudflare/workers-types" />

// /account/name: change your name.

import { updateName } from '../../../platform/account';
import { PersonService } from '../../../platform/storage/person-service';
import { setValue, type SignInPagesEnv } from '../../sign-in/_shared';
import { accountPage, backToAccount, field, formOf, signedIn } from '../_account';

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const person = await new PersonService(signed.env.PLATFORM_DB).getPerson(signed.person.id);
  return accountPage(env, request, '/account/name/', {
    fill: (rewriter) =>
      rewriter
        .on('input[name="given_name"]', setValue(person?.given_name ?? ''))
        .on('input[name="family_name"]', setValue(person?.family_name ?? '')),
  });
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const form = await formOf(request);
  await updateName(
    signed.env.PLATFORM_DB,
    signed.person.id,
    field(form, 'given_name').slice(0, 100),
    field(form, 'family_name').slice(0, 100),
  );
  return backToAccount('name');
};
