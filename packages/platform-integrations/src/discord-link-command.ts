import { t } from '@lasvegasfortransit/platform-core/messages';
import { DiscordHttp } from './discord-http';
import { discordId, DiscordApiFailure, object, type DiscordOptions } from './discord-types';

export const LINK_COMMAND = Object.freeze({
  type: 1,
  name: 'link',
  description: t('discord.commandDescription'),
  options: [],
});
export interface RegisterLinkCommandOptions {
  applicationId: string;
  guildId: string;
  botToken: string;
  fetcher?: typeof fetch;
  rateLimit?: DiscordOptions['rateLimit'];
}
function existingLinkCommand(commands: unknown): Record<string, unknown> | null {
  if (!Array.isArray(commands)) throw new DiscordApiFailure('invalid_response');
  const matching = commands
    .map(object)
    .filter((command) => command.name === 'link' && command.type === 1);
  if (matching.length > 1) throw new Error('Discord has multiple guild commands named link.');
  const command = matching[0];
  if (!command) return null;
  if (!discordId(command.id)) throw new DiscordApiFailure('invalid_response');
  return command;
}
function matches(command: Record<string, unknown> | null): boolean {
  return (
    command?.description === LINK_COMMAND.description &&
    (command.options === undefined ||
      (Array.isArray(command.options) && command.options.length === 0))
  );
}
/** Upsert only the guild chat-input command, then confirm its stored definition. */
export async function registerLinkCommand({
  applicationId,
  guildId,
  botToken,
  fetcher,
  rateLimit,
}: RegisterLinkCommandOptions): Promise<'created' | 'updated' | 'confirmed'> {
  if (!discordId(applicationId) || !discordId(guildId) || !/^[\x21-\x7e]{1,2048}$/.test(botToken))
    throw new DiscordApiFailure('not_configured');
  const client = new DiscordHttp({
    ...(fetcher ? { fetch: fetcher } : {}),
    ...(rateLimit ? { rateLimit } : {}),
  });
  const path = `/applications/${applicationId}/guilds/${guildId}/commands`;
  const authorization = `Bot ${botToken}`;
  const read = async () => existingLinkCommand(await client.request(path, { authorization }));
  const existing = await read();
  if (matches(existing)) return 'confirmed';
  await client.request(existing ? `${path}/${String(existing.id)}` : path, {
    authorization,
    method: existing ? 'PATCH' : 'POST',
    commandRegistration: true,
    jsonBody: existing
      ? {
          name: LINK_COMMAND.name,
          description: LINK_COMMAND.description,
          options: LINK_COMMAND.options,
        }
      : LINK_COMMAND,
  });
  if (!matches(await read())) throw new DiscordApiFailure('invalid_response');
  return existing ? 'updated' : 'created';
}
