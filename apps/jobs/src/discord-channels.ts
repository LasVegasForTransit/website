import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  parseDiscordChannelsInput,
  readDiscordChannels,
} from '@lasvegasfortransit/platform-integrations/discord-channels';
import { discordRateLimit } from '@lasvegasfortransit/platform-integrations/discord-rate-limit';
import {
  discordRuntime,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';
import type { DiscordOptions } from '@lasvegasfortransit/platform-integrations/discord-role-catalog';
import { readDiscordInput } from './discord-request';

function response(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** The site asks which channels a member's roles open; only names and ids come back. */
export async function handleDiscordChannelsRequest(
  request: Request,
  env: DiscordRuntimeEnv & { PLATFORM_DB: Db },
  options: DiscordOptions = {},
): Promise<Response> {
  if (request.method !== 'POST' || request.url !== 'https://jobs.internal/discord/channels')
    return response({ kind: 'not_found' }, 404);
  if (request.headers.get('Content-Type') !== 'application/json')
    return response({ kind: 'invalid' }, 400);
  const input = parseDiscordChannelsInput(await readDiscordInput(request));
  if (!input) return response({ kind: 'invalid' }, 400);
  const runtime = discordRuntime(env);
  if (!runtime) return response({ kind: 'unavailable' }, 503);
  try {
    const channels = await readDiscordChannels(runtime.configuration, runtime.memberRoleId, input, {
      ...options,
      rateLimit: discordRateLimit(env.PLATFORM_DB, runtime.applicationId),
    });
    return response({ channels });
  } catch {
    return response({ kind: 'unavailable' }, 503);
  }
}
