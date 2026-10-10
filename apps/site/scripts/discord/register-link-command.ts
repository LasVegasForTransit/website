import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';

const COMMAND = {
  name: 'link',
  description: 'Connect your Discord to your LVBT account to get your member role',
};

export interface RegisterLinkCommandOptions {
  applicationId: string;
  guildId: string;
  botToken: string;
  fetcher?: typeof fetch;
}

interface DiscordCommand {
  id: string;
}

async function discordRequest({
  fetcher,
  url,
  botToken,
  method,
  body,
}: {
  fetcher: typeof fetch;
  url: string;
  botToken: string;
  method: 'GET' | 'POST' | 'PATCH';
  body?: typeof COMMAND;
}): Promise<unknown> {
  const response = await fetcher(url, {
    method,
    headers: {
      Authorization: `Bot ${botToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    throw new Error(`Discord returned HTTP ${response.status} while ${method}ing a guild command.`);
  try {
    return await response.json();
  } catch {
    throw new Error('Discord returned an unreadable response while registering /link.');
  }
}

function existingLinkCommand(commands: unknown[]): DiscordCommand | null {
  const matching = commands.filter(
    (command): command is Record<string, unknown> =>
      command !== null &&
      typeof command === 'object' &&
      !Array.isArray(command) &&
      'name' in command &&
      command.name === 'link',
  );
  if (matching.length > 1) throw new Error('Discord has multiple guild commands named link.');
  const command = matching[0];
  if (!command) return null;
  if (!isDiscordId(command.id)) throw new Error('Discord returned an invalid ID for /link.');
  return { id: command.id };
}

/** Create or update only the /link command in the configured LVBT guild. */
export async function registerLinkCommand({
  applicationId,
  guildId,
  botToken,
  fetcher = fetch,
}: RegisterLinkCommandOptions): Promise<'created' | 'updated'> {
  if (!isDiscordId(applicationId)) throw new Error('LVBT_DISCORD_APPLICATION_ID is invalid.');
  if (!isDiscordId(guildId)) throw new Error('LVBT_DISCORD_GUILD_ID is invalid.');
  if (!botToken.trim()) throw new Error('LVBT_DISCORD_BOT_TOKEN is required.');
  const collection = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
  const commands = await discordRequest({ fetcher, url: collection, botToken, method: 'GET' });
  if (!Array.isArray(commands)) throw new Error('Discord returned an invalid guild command list.');
  const existing = existingLinkCommand(commands);
  if (existing) {
    await discordRequest({
      fetcher,
      url: `${collection}/${existing.id}`,
      botToken,
      method: 'PATCH',
      body: COMMAND,
    });
    return 'updated';
  }
  await discordRequest({ fetcher, url: collection, botToken, method: 'POST', body: COMMAND });
  return 'created';
}

export interface RegistrationIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

const processIo: RegistrationIo = {
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
};

export async function runLinkCommandRegistration(
  env: Record<string, string | undefined> = process.env,
  io: RegistrationIo = processIo,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const applicationId = env.LVBT_DISCORD_APPLICATION_ID?.trim() ?? '';
  const guildId = env.LVBT_DISCORD_GUILD_ID?.trim() ?? '';
  const botToken = env.LVBT_DISCORD_BOT_TOKEN?.trim() ?? '';
  if (!applicationId || !guildId || !botToken) {
    io.stderr(
      'Set LVBT_DISCORD_APPLICATION_ID, LVBT_DISCORD_GUILD_ID, and LVBT_DISCORD_BOT_TOKEN in this process.',
    );
    return 2;
  }
  try {
    const result = await registerLinkCommand({ applicationId, guildId, botToken, fetcher });
    io.stdout(`/link ${result} in the configured LVBT Discord server.`);
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : 'Discord command registration failed.');
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runLinkCommandRegistration();
