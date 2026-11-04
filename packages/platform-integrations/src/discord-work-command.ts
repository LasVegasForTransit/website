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
    {
      type: 1,
      name: 'show',
      description: t('discordWork.show'),
      options: [{ type: 3, name: 'url', description: 'Notion page to inspect' }],
    },
    {
      type: 1,
      name: 'adopt-project',
      description: 'Connect this existing post to a project',
      options: [{ type: 3, name: 'url', description: 'Notion project page URL', required: true }],
    },
    {
      type: 1,
      name: 'adopt-event',
      description: 'Connect this existing thread to an event',
      options: [{ type: 3, name: 'url', description: 'Notion event page URL', required: true }],
    },
    { type: 1, name: 'routes', description: 'Inspect saved Notion routes' },
    {
      type: 1,
      name: 'project-topic',
      description: 'Review the Notion link in a project forum topic',
      options: [
        {
          type: 7,
          name: 'destination',
          description: 'Linked project forum',
          required: true,
          channel_types: [15],
        },
      ],
    },
    {
      type: 1,
      name: 'project-event-tags',
      description: 'Choose tags for a project forum’s event posts',
      options: [
        {
          type: 7,
          name: 'destination',
          description: 'Linked project forum',
          required: true,
          channel_types: [15],
        },
      ],
    },
    { type: 1, name: 'destinations', description: 'Check your destination creation requests' },
    {
      type: 1,
      name: 'create-category',
      description: 'Create a category for project forums or events',
      options: [{ type: 3, name: 'name', description: 'Name of the new category', required: true }],
    },
    ...(['create-event-forum', 'create-event-channel'] as const).map((name) => ({
      type: 1,
      name,
      description:
        name === 'create-event-forum' ? 'Create an events forum' : 'Create an events text channel',
      options: [
        { type: 3, name: 'name', description: 'Name of the new destination', required: true },
        {
          type: 7,
          name: 'category',
          description: 'Category for the new destination',
          required: true,
          channel_types: [4],
        },
      ],
    })),
    {
      type: 1,
      name: 'route-project',
      description: 'Set up a Notion source for project forums',
      options: [
        {
          type: 7,
          name: 'destination',
          description: 'Category for project forums',
          required: true,
          channel_types: [4],
        },
      ],
    },
    {
      type: 1,
      name: 'route-event',
      description: 'Set up a Notion source for event conversations',
      options: [
        {
          type: 7,
          name: 'destination',
          description: 'Existing events channel or forum',
          required: true,
          channel_types: [0, 15],
        },
      ],
    },
    {
      type: 1,
      name: 'route-event-project',
      description: 'Route events to their project forums',
      options: [
        {
          type: 7,
          name: 'destination',
          description: 'Category containing approved project forums',
          required: true,
          channel_types: [4],
        },
      ],
    },
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
