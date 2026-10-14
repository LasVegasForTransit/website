/// <reference types="@cloudflare/workers-types" />
import type { SignInPagesEnv } from '../../sign-in/_shared';
import { discordPlatform } from './_discord';
import { completeDiscordConnection } from './_callback';
export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  return await completeDiscordConnection(discordPlatform(env), request);
};
