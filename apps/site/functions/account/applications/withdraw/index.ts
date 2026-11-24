/// <reference types="@cloudflare/workers-types" />

// /account/applications/withdraw: withdraw one of your own waiting
// applications. Posted from the Get involved section of /account/.

import { CommitteeApplicationService } from '@lasvegasfortransit/platform-storage/committee-applications';
import type { SignInPagesEnv } from '../../../sign-in/_shared';
import { backToAccount, field, formOf, signedIn } from '../../_account';

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const form = await formOf(request);
  const id = field(form, 'id').slice(0, 40);
  // Withdrawing twice, or something already decided, lands on the same page.
  await new CommitteeApplicationService(signed.env.PLATFORM_DB).withdraw(signed.person.id, id);
  return backToAccount('application_withdrawn');
};
