import { readDiscordInput, discordResponse } from './discord-request';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  joinDiscordMember,
  parseDiscordJoinInput,
} from '@lasvegasfortransit/platform-integrations/discord-join';
import type { DiscordRuntimeEnv } from '@lasvegasfortransit/platform-integrations/discord-runtime';

export async function handleDiscordJoinRequest(
  request: Request,
  env: DiscordRuntimeEnv & { PLATFORM_DB: Db },
  options: Parameters<typeof joinDiscordMember>[3] = {},
): Promise<Response> {
  if (request.method !== 'POST' || request.url !== 'https://jobs.internal/discord/join')
    return discordResponse('failed', 404);
  if (request.headers.get('Content-Type') !== 'application/json')
    return discordResponse('failed', 400);
  const input = parseDiscordJoinInput(await readDiscordInput(request));
  if (!input) return discordResponse('failed', 400);
  const result = await joinDiscordMember(env.PLATFORM_DB, env, input, options);
  return discordResponse(result.kind, 200);
}
