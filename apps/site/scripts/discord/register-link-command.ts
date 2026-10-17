import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerLinkCommand } from '@lasvegasfortransit/platform-integrations/discord-link-command';
export { registerLinkCommand } from '@lasvegasfortransit/platform-integrations/discord-link-command';

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
