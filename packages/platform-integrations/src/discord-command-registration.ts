import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  COMMAND_RETRY_MS,
  claimDiscordCommand,
  settleDiscordCommand,
} from '@lasvegasfortransit/platform-storage/discord-command-checkpoint';
import {
  LINK_COMMAND,
  registerGuildChatCommand,
  type GuildChatCommand,
  type RegisterLinkCommandOptions,
} from './discord-link-command';
import { discordRateLimit } from './discord-rate-limit';
import { DiscordApiFailure } from './discord-types';

export async function runDiscordCommandRegistration(
  db: Db,
  input: Omit<RegisterLinkCommandOptions, 'rateLimit'> & {
    now?: () => Date;
    command?: GuildChatCommand;
  },
): Promise<{ kind: 'idle' | 'complete' | 'paused' | 'failed' }> {
  const now = input.now ?? (() => new Date());
  const command = input.command ?? LINK_COMMAND;
  const digest = await digestToken(JSON.stringify(command));
  const contextId = `command-${command.name}:${input.applicationId}:${input.guildId}:${digest}`;
  const lease = await claimDiscordCommand(db, contextId, now());
  if (!lease) return { kind: 'idle' };
  try {
    await registerGuildChatCommand(
      {
        ...input,
        rateLimit: discordRateLimit(db, input.applicationId, now),
      },
      command,
    );
    const saved = await settleDiscordCommand(db, lease, now(), { complete: true });
    return { kind: saved ? 'complete' : 'failed' };
  } catch (error) {
    const limited = error instanceof DiscordApiFailure && error.kind === 'rate_limited';
    await settleDiscordCommand(db, lease, now(), {
      complete: false,
      retryAfterMs: limited ? (error.retryAfterMs ?? COMMAND_RETRY_MS) : COMMAND_RETRY_MS,
    });
    return { kind: limited ? 'paused' : 'failed' };
  }
}
