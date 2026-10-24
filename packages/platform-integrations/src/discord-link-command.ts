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
function existingGuildCommand(
  commands: unknown,
  definition: GuildChatCommand,
): Record<string, unknown> | null {
  if (!Array.isArray(commands)) throw new DiscordApiFailure('invalid_response');
  const matching = commands
    .map(object)
    .filter((command) => command.name === definition.name && command.type === definition.type);
  if (matching.length > 1)
    throw new Error(`Discord has multiple guild commands named ${definition.name}.`);
  const command = matching[0];
  if (!command) return null;
  if (!discordId(command.id)) throw new DiscordApiFailure('invalid_response');
  return command;
}
function matches(command: Record<string, unknown> | null, definition: GuildChatCommand): boolean {
  return (
    command?.description === definition.description &&
    JSON.stringify(normalizeOptions(command.options)) ===
      JSON.stringify(normalizeOptions(definition.options))
  );
}
function normalizeOptions(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => {
    const o = object(v);
    return {
      type: o.type,
      name: o.name,
      description: o.description,
      required: o.required === true,
      channel_types: o.channel_types ?? [],
      options: normalizeOptions(o.options),
    };
  });
}
export interface DiscordCommandOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  channel_types?: number[];
  options?: readonly DiscordCommandOption[];
}
export interface GuildChatCommand {
  type: number;
  name: string;
  description: string;
  options: readonly DiscordCommandOption[];
}
/** Upsert only the named guild chat-input command, then confirm its stored definition. */
export async function registerGuildChatCommand(
  { applicationId, guildId, botToken, fetcher, rateLimit }: RegisterLinkCommandOptions,
  definition: GuildChatCommand,
): Promise<'created' | 'updated' | 'confirmed'> {
  if (!discordId(applicationId) || !discordId(guildId) || !/^[\x21-\x7e]{1,2048}$/.test(botToken))
    throw new DiscordApiFailure('not_configured');
  const client = new DiscordHttp({
    ...(fetcher ? { fetch: fetcher } : {}),
    ...(rateLimit ? { rateLimit } : {}),
  });
  const path = `/applications/${applicationId}/guilds/${guildId}/commands`;
  const authorization = `Bot ${botToken}`;
  const read = async () =>
    existingGuildCommand(await client.request(path, { authorization }), definition);
  const existing = await read();
  if (matches(existing, definition)) return 'confirmed';
  await client.request(existing ? `${path}/${String(existing.id)}` : path, {
    authorization,
    method: existing ? 'PATCH' : 'POST',
    commandRegistration: true,
    jsonBody: existing
      ? {
          name: definition.name,
          description: definition.description,
          options: definition.options,
        }
      : definition,
  });
  if (!matches(await read(), definition)) throw new DiscordApiFailure('invalid_response');
  return existing ? 'updated' : 'created';
}

export function registerLinkCommand(
  options: RegisterLinkCommandOptions,
): Promise<'created' | 'updated' | 'confirmed'> {
  return registerGuildChatCommand(options, LINK_COMMAND);
}
