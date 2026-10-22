import { t } from '@lasvegasfortransit/platform-core/messages';
import type { GuildChatCommand } from './discord-link-command';
export const WORK_COMMAND: GuildChatCommand = {
  type: 1,
  name: 'work',
  description: t('discordWork.command'),
  options: [
    {
      type: 1,
      name: 'link',
      description: t('discordWork.link'),
      options: [
        { type: 3, name: 'url', description: t('discordWork.url'), required: true },
        {
          type: 7,
          name: 'destination',
          description: t('discordWork.destination'),
          channel_types: [0, 4, 11, 12, 15],
        },
      ],
    },
    { type: 1, name: 'show', description: t('discordWork.show') },
    {
      type: 1,
      name: 'unlink',
      description: t('discordWork.unlink'),
      options: [{ type: 3, name: 'url', description: t('discordWork.url') }],
    },
  ],
};
export const SAVE_TO_NOTION_COMMAND: GuildChatCommand = {
  type: 3,
  name: 'Save to Notion',
  description: '',
  options: [],
};
