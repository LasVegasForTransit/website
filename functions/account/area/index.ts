/// <reference types="@cloudflare/workers-types" />

// /account/area: set your area from a home address (used once, then
// deleted) or a ZIP code.

import { updateArea } from '../../../platform/account';
import { t } from '../../../platform/messages';
import { PersonService } from '../../../platform/storage/person-service';
import { showText } from '../../join/_page';
import { fieldError, setValue, type SignInPagesEnv } from '../../sign-in/_shared';
import { accountPage, backToAccount, field, formOf, signedIn } from '../_account';

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const person = await new PersonService(signed.env.PLATFORM_DB).getPerson(signed.person.id);
  return accountPage(env, request, '/account/area/', {
    fill: (rewriter) => rewriter.on('input[name="zip"]', setValue(person?.zip ?? '')),
  });
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const form = await formOf(request);
  const zip = field(form, 'zip').slice(0, 10);
  const outcome = await updateArea(signed.env.PLATFORM_DB, signed.person.id, {
    address: field(form, 'address').slice(0, 300),
    zip,
  });
  if (outcome === 'placed') return backToAccount('area_placed');
  if (outcome === 'updated') return backToAccount('area');
  // The address is never sent back into the page: it is used once only.
  return accountPage(env, request, '/account/area/', {
    fill: (rewriter) => {
      const kept = rewriter.on('input[name="zip"]', setValue(zip));
      if (outcome === 'invalid_zip') return fieldError(kept, 'zip');
      const notice =
        outcome === 'not_placed'
          ? t('account.areaNotPlaced')
          : outcome === 'unavailable'
            ? t('account.areaUnavailable')
            : t('account.areaEmpty');
      return kept.on('[data-slot="notice"]', showText(notice));
    },
    status: 400,
  });
};
