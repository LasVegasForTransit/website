/// <reference types="@cloudflare/workers-types" />

// /account/data: GET explains the file; POST answers with it, as
// lvbt-my-data-YYYY-MM-DD.json.

import { exportData } from '../../../platform/account-data';
import type { SignInPagesEnv } from '../../sign-in/_shared';
import { accountPage, signedIn } from '../_account';

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  return accountPage(env, request, '/account/data/');
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const data = await exportData(signed.env.PLATFORM_DB, signed.person.id);
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
