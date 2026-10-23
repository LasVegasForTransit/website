import { t } from '@lasvegasfortransit/platform-core/messages';
import {
  taskMarkdown,
  taskDeadline,
  taskNotionLink,
  type DiscordTaskMessage,
  type DiscordTaskComponent,
} from './notion-task-cards';
import type { NotionTaskSnapshot } from './notion-task-types';
import type { ProjectHome, WorkConversation, WorkState } from './discord-work-types';
export function workMessage(components: DiscordTaskComponent[]): DiscordTaskMessage {
  return { flags: 32768, allowed_mentions: { parse: [] }, components: [{ type: 17, components }] };
}
export function workButton(id: string, label: string, disabled = false): DiscordTaskComponent {
  return { type: 2, style: 2, custom_id: id, label, disabled };
}
export function workText(content: string): DiscordTaskComponent {
  return { type: 10, content };
}
export function workCustomId(link: { id: string; generation: number }, action: string) {
  const value = `work:${link.id}:${link.generation}:${action}`;
  if (!/^[\w:-]{1,100}$/.test(value)) throw new Error('invalid_work_control');
  return value;
}
function section(title: string, url: string): DiscordTaskComponent {
  return {
    type: 9,
    components: [workText(`### ${taskMarkdown(title)}`)],
    accessory: { type: 2, style: 5, label: t('discordWork.openNotion'), url: taskNotionLink(url) },
  };
}
export function projectWorkCard(
  home: ProjectHome,
  project: { title: string; url: string },
  state: WorkState,
): DiscordTaskMessage {
  const rows = [
    section(project.title, project.url),
    {
      type: 1,
      components: [
        workButton(workCustomId(home, 'tasks'), t('discordWork.viewTasks'), state !== 'active'),
      ],
    },
  ];
  if (state !== 'active')
    rows.push(
      workText(
        state === 'preview'
          ? t('discordWork.preview')
          : state === 'unlinked'
            ? t('discordWork.unlinked')
            : t('discordWork.paused'),
      ),
    );
  return workMessage(rows);
}
export function sharedTaskCard(
  conversation: WorkConversation,
  task: NotionTaskSnapshot,
  state: WorkState,
): DiscordTaskMessage {
  const disabled = state !== 'active' || task.status === 'Done';
  const rows: DiscordTaskComponent[] = [
    section(task.title, task.url),
    workText(
      task.dueDate
        ? t('discordWork.taskDue', {
            date: taskDeadline(task, task.dueTimeZone ?? 'America/Los_Angeles'),
          })
        : t('discordWork.noDeadline'),
    ),
  ];
  rows.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: workCustomId(conversation, 'status'),
        placeholder: t('discordWork.status'),
        disabled,
        options: ['Not started', 'In progress', 'Done'].map((value) => ({
          label: value,
          value,
          default: task.status === value,
        })),
      },
    ],
  });
  if (task.status !== 'Done')
    rows.push({
      type: 1,
      components: [
        workButton(workCustomId(conversation, 'note'), t('discordWork.addUpdate'), disabled),
      ],
    });
  if (state !== 'active')
    rows.push(
      workText(
        state === 'unlinked'
          ? t('discordWork.unlinked')
          : state === 'preview'
            ? t('discordWork.preview')
            : t('discordWork.paused'),
      ),
    );
  return workMessage(rows);
}
