import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import {
  disconnectDiscordMember,
  parseDiscordDisconnectInput,
} from '@lasvegasfortransit/platform-integrations/discord-disconnect';
import type { DiscordRuntimeEnv } from '@lasvegasfortransit/platform-integrations/discord-runtime';
import { discordResponse, readDiscordInput } from './discord-request';

export async function handleDiscordDisconnectRequest(
  request: Request,
  env: DiscordRuntimeEnv & { PLATFORM_DB: Db },
  options: Parameters<typeof disconnectDiscordMember>[3] = {},
): Promise<Response> {
  if (request.method !== 'POST' || request.url !== 'https://jobs.internal/discord/disconnect')
    return discordResponse('failed', 404);
  if (request.headers.get('Content-Type') !== 'application/json')
    return discordResponse('failed', 400);
  const input = parseDiscordDisconnectInput(await readDiscordInput(request));
  if (!input) return discordResponse('failed', 400);
  const result = await disconnectDiscordMember(
    queryBudget(env.PLATFORM_DB, 50).db,
    env,
    input,
    options,
  );
  return discordResponse(result.kind, 200);
}
