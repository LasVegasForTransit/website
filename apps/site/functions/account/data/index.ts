/// <reference types="@cloudflare/workers-types" />

// /account/data: GET explains the file; POST answers with it, as
// lvbt-my-data-YYYY-MM-DD.json.

import { exportData } from '../../../platform/account-data';
import type { SignInPagesEnv } from '../../sign-in/_shared';
import { accountPage, signedIn } from '../_account';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { readCookie, SESSION_COOKIE } from '@lasvegasfortransit/platform-core/web-auth';
import { signInRedirect } from '../../../platform/sign-in';

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  return accountPage(env, request, '/account/data/');
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return signInRedirect(request, true);
  const data = await exportData(signed.env.PLATFORM_DB, signed.person.id, {
    kind: 'member',
    personId: signed.person.id,
    sessionHash: await hashWithSecret(signed.env.LVBT_SIGN_IN_SECRET, `session:${token}`),
  });
  if (!data) return signInRedirect(request, true);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="lvbt-my-data-${day}.json"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
