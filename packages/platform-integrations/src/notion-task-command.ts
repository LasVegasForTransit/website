import { t } from '@lasvegasfortransit/platform-core/messages';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { runDiscordCommandRegistration } from './discord-command-registration';
import type { RegisterLinkCommandOptions } from './discord-link-command';

export const TASK_CHECKIN_COMMAND = Object.freeze({
  type: 1,
  name: 'checkins',
  description: t('taskCheckins.commandDescription'),
  options: [],
});
export function runTaskCheckinCommandRegistration(db: Db, input: RegisterLinkCommandOptions) {
  return runDiscordCommandRegistration(db, { ...input, command: TASK_CHECKIN_COMMAND });
}
