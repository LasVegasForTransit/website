import { saveDiscordRegionVisibility } from '@lasvegasfortransit/platform-storage/discord-region';
import { SESSION_COOKIE, readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { signedIn, formOf, field, backToAccount } from '../../_account';
import type { SignInPagesEnv } from '../../../sign-in/_shared';

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const form = await formOf(request),
    visible = field(form, 'visible');
  if (!['', '1'].includes(visible))
    return new Response(null, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
  const saved = await saveDiscordRegionVisibility(signed.env, {
    personId: signed.person.id,
    sessionToken: readCookie(request, SESSION_COOKIE) ?? '',
    visible: visible === '1',
  });
  const response = saved ? backToAccount('discord_region') : new Response(null, { status: 403 });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
};
