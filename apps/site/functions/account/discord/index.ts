/// <reference types="@cloudflare/workers-types" />
import { accountPage } from '../_account';
import { show, showText, SECURITY_HEADERS } from '../../join/_page';
import { setValue, formOf, field, type SignInPagesEnv } from '../../sign-in/_shared';
import { discordMember, discordReply, discordStateCookie } from './_discord';

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await discordMember(env, request);
  if (signed instanceof Response) return signed;
  const csrf = await signed.client.formToken(signed.sessionToken, new URL(request.url).origin);
  if (!csrf) return discordReply('Connecting Discord is unavailable. Please try again later.', 503);
  const response = await accountPage(env, request, '/account/discord/', {
    fill: (rewriter) => {
      let filled = rewriter.on('input[name="token"]', setValue(csrf));
      if (signed.profile.linked)
        filled = filled.on(
          '[data-slot="discord-status"]',
          showText(
            signed.profile.username
              ? `Connected as ${signed.profile.username}.`
              : 'Your Discord account is connected.',
          ),
        );
      if (signed.profile.ambiguous)
        return filled
          .on('[data-slot="discord-review"]', show())
          .on('[data-slot="discord-connect"]', {
            element(element) {
              element.remove();
            },
          });
      if (new URL(request.url).searchParams.get('result') === 'failed')
        filled = filled.on('[data-slot="discord-error"]', show());
      return filled;
    },
  });
  response.headers.set(
    'Content-Security-Policy',
    SECURITY_HEADERS['Content-Security-Policy'].replace(
      "form-action 'self' https://givebutter.com",
      "form-action 'self' https://discord.com",
    ),
  );
  return response;
};
export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const origin = new URL(request.url).origin;
  if (request.headers.get('Origin') !== origin)
    return discordReply('Reload this page and try again.', 403);
  const signed = await discordMember(env, request);
  if (signed instanceof Response) return signed;
  const form = await formOf(request);
  const started = await signed.client.start({
    sessionToken: signed.sessionToken,
    origin,
    csrfToken: field(form, 'token'),
  });
  return started
    ? discordReply(null, 303, {
        Location: started.url,
        'Set-Cookie': discordStateCookie(started.state),
      })
    : discordReply('This form expired. Return to your account and connect Discord again.', 409);
};
