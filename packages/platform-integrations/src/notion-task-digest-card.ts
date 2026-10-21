import { t } from '@lasvegasfortransit/platform-core/messages';
import {
  taskMarkdown,
  taskNotionLink,
  type DiscordTaskMessage,
  type DiscordTaskComponent,
} from './notion-task-cards';
import type { NotionTaskSnapshot } from './notion-task-types';
export function renderTaskDigest(input: {
  day: string;
  tasks: NotionTaskSnapshot[];
  more: boolean;
}): DiscordTaskMessage {
  const components: DiscordTaskComponent[] = [
    { type: 10, content: `### ${t('taskCheckins.digestTitle', { day: input.day })}` },
  ];
  for (const task of input.tasks.slice(0, 5))
    components.push({
      type: 9,
      components: [
        {
          type: 10,
          content: `**${taskMarkdown(task.title.slice(0, 120))}**\n${taskMarkdown(task.status.slice(0, 60))} · ${t('taskCheckins.due', { deadline: task.dueDate ?? '—' })}`,
        },
      ],
      accessory: {
        type: 2,
        style: 5,
        label: t('taskCheckins.openNotion'),
        url: taskNotionLink(task.url),
      },
    });
  if (input.more) components.push({ type: 10, content: t('taskCheckins.digestMore') });
  components.push({ type: 10, content: t('taskCheckins.digestPreferences') });
  return { flags: 32768, allowed_mentions: { parse: [] }, components: [{ type: 17, components }] };
}
