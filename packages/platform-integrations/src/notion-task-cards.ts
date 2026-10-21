import { t } from '@lasvegasfortransit/platform-core/messages';
import { notionObject, type NotionTaskSnapshot } from './notion-task-types';
import { taskCheckinScheduleSummary, type TaskCheckinPolicy } from './notion-task-policy';

export interface DiscordTaskComponent {
  type: number;
  content?: string;
  label?: string;
  style?: number;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
  components?: DiscordTaskComponent[];
  accessory?: DiscordTaskComponent;
  component?: DiscordTaskComponent;
  max_length?: number;
  required?: boolean;
}
export interface DiscordTaskMessage {
  flags: number;
  allowed_mentions: { parse: never[] };
  components: DiscordTaskComponent[];
}
const ACTIONS = [
  'progress',
  'blocker',
  'complete',
  'confirm',
  'snooze',
  'extension',
  'preferences',
  'cancel',
] as const;
export type TaskCardAction = (typeof ACTIONS)[number];
export type TaskCardState =
  'ready' | 'pending' | 'confirmed' | 'failed' | 'stale' | 'snoozed' | 'changed';
export type TaskCustomId =
  | { kind: 'task'; token: string; action: TaskCardAction }
  | { kind: 'setup'; sourceId: string; revision: number; state: 'active' | 'paused' | 'opted_out' };
export function parseTaskCustomId(value: unknown): TaskCustomId | null {
  if (typeof value !== 'string' || value.length > 100) return null;
  const task = /^tc:([\w-]{43}):([a-z]+)$/.exec(value);
  if (task?.[1] && ACTIONS.some((action) => action === task[2]))
    return { kind: 'task', token: task[1], action: task[2] as TaskCardAction };
  const setup = /^tcs:([\w-]{1,50}):([1-9]\d{0,9}):(active|paused|opted_out)$/.exec(value);
  if (setup?.[1] && setup[2] && setup[3])
    return {
      kind: 'setup',
      sourceId: setup[1],
      revision: Number(setup[2]),
      state: setup[3] as 'active' | 'paused' | 'opted_out',
    };
  return null;
}
export function taskMarkdown(value: string): string {
  let result = value.replaceAll('@', '@\u200b');
  for (const char of ['\\', '`', '*', '_', '~', '|', '<', '>', '[', ']'])
    result = result.replaceAll(char, `\\${char}`);
  return result;
}
function button(
  token: string,
  action: TaskCardAction,
  label: string,
  options: { disabled?: boolean; style?: number } = {},
): DiscordTaskComponent {
  return {
    type: 2,
    style: options.style ?? 2,
    label,
    custom_id: `tc:${token}:${action}`,
    disabled: options.disabled ?? false,
  };
}
function message(components: DiscordTaskComponent[]): DiscordTaskMessage {
  return { flags: 32768, allowed_mentions: { parse: [] }, components: [{ type: 17, components }] };
}
function deadline(task: NotionTaskSnapshot, timezone: string): string {
  if (!task.dueDate) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate))
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${task.dueDate}T12:00:00Z`),
    );
  const time = Date.parse(task.dueDate);
  if (Number.isFinite(time) && /(?:Z|[+-]\d{2}:\d{2})$/.test(task.dueDate))
    return `<t:${Math.floor(time / 1000)}:F>`;
  return `${task.dueDate.replace('T', ' ')} (${task.dueTimeZone ?? timezone})`;
}
export function taskNotionLink(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !['notion.so', 'www.notion.so'].includes(url.hostname) ||
    url.username ||
    url.password ||
    value.length > 512
  )
    throw new Error('The task link is unavailable');
  return url.href;
}
export function renderTaskCard(input: {
  token: string;
  task: NotionTaskSnapshot;
  policy: TaskCheckinPolicy;
  active: boolean;
  state?: TaskCardState;
}): DiscordTaskMessage {
  if (!/^[\w-]{43}$/.test(input.token)) throw new Error('The task card reference is invalid');
  const { token, task, policy, active, state = 'ready' } = input;
  const disabled =
    !active || task.status === 'Done' || ['pending', 'stale', 'failed'].includes(state);
  const controls: DiscordTaskComponent[] = [];
  if (policy.actions.progress)
    controls.push(button(token, 'progress', t('taskCheckins.progress'), { disabled, style: 1 }));
  if (policy.actions.blocker)
    controls.push(button(token, 'blocker', t('taskCheckins.blocker'), { disabled }));
  if (policy.actions.complete)
    controls.push(button(token, 'complete', t('taskCheckins.complete'), { disabled, style: 3 }));
  const components: DiscordTaskComponent[] = [
    {
      type: 9,
      components: [
        {
          type: 10,
          content: `### ${taskMarkdown(task.title)}\n${t('taskCheckins.yourTask')} · ${taskMarkdown(task.status)}\n${t('taskCheckins.due', { deadline: deadline(task, policy.timezone) })}`,
        },
      ],
      accessory: {
        type: 2,
        style: 5,
        label: t('taskCheckins.openNotion'),
        url: taskNotionLink(task.url),
      },
    },
  ];
  if (task.description) components.push({ type: 10, content: taskMarkdown(task.description) });
  if (state !== 'ready') {
    const labels = {
      pending: t('taskCheckins.pending'),
      confirmed: t('taskCheckins.saved'),
      failed: t('taskCheckins.notSaved'),
      stale: t('taskCheckins.stale'),
      changed: t('taskCheckins.stale'),
      snoozed: t('taskCheckins.snoozed'),
    } as const;
    components.push({ type: 10, content: labels[state] });
  }
  if (controls.length) components.push({ type: 1, components: controls });
  const other = [button(token, 'snooze', t('taskCheckins.snooze'), { disabled })];
  if (policy.actions.extension)
    other.push(button(token, 'extension', t('taskCheckins.extension'), { disabled }));
  other.push(button(token, 'preferences', t('taskCheckins.preferences')));
  components.push({ type: 1, components: other });
  return message(components);
}
export function renderTaskStopControls(input: {
  sourceId: string;
  revision: number;
}): DiscordTaskMessage {
  return message([
    {
      type: 10,
      content: `### ${t('taskCheckins.preferencesTitle')}\n${t('taskCheckins.preferencesUnavailable')}`,
    },
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: t('taskCheckins.pause'),
          custom_id: `tcs:${input.sourceId}:${input.revision}:paused`,
        },
        {
          type: 2,
          style: 2,
          label: t('taskCheckins.optOut'),
          custom_id: `tcs:${input.sourceId}:${input.revision}:opted_out`,
        },
      ],
    },
  ]);
}
export function renderTaskSetup(input: {
  sourceId: string;
  revision: number;
  policy: TaskCheckinPolicy;
}): DiscordTaskMessage {
  const custom = (state: string) => `tcs:${input.sourceId}:${input.revision}:${state}`;
  return message([
    { type: 10, content: `### ${t('taskCheckins.setupTitle')}\n${t('taskCheckins.setupBody')}` },
    { type: 10, content: taskCheckinScheduleSummary(input.policy) },
    { type: 10, content: t('taskCheckins.setupHint') },
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: t('taskCheckins.enable'), custom_id: custom('active') },
        { type: 2, style: 2, label: t('taskCheckins.pause'), custom_id: custom('paused') },
        { type: 2, style: 2, label: t('taskCheckins.optOut'), custom_id: custom('opted_out') },
      ],
    },
  ]);
}
export function renderTaskModal(token: string, action: 'progress' | 'blocker' | 'extension') {
  const titles = {
    progress: t('taskCheckins.progressTitle'),
    blocker: t('taskCheckins.blockerTitle'),
    extension: t('taskCheckins.extensionTitle'),
  } as const;
  return {
    type: 9,
    data: {
      custom_id: `tc:${token}:${action}`,
      title: titles[action],
      components: [
        {
          type: 18,
          label: t('taskCheckins.noteLabel'),
          description: action === 'extension' ? t('taskCheckins.extensionHint') : undefined,
          component: { type: 4, custom_id: 'note', style: 2, required: true, max_length: 1800 },
        },
      ],
    },
  };
}
export function renderTaskCompletion(token: string): DiscordTaskMessage {
  return message([
    { type: 10, content: t('taskCheckins.completePrompt') },
    {
      type: 1,
      components: [
        button(token, 'confirm', t('taskCheckins.confirmComplete'), { style: 3 }),
        button(token, 'cancel', t('taskCheckins.cancel')),
      ],
    },
  ]);
}
export function taskModalText(data: unknown): string | null {
  const form = notionObject(data);
  if (!Array.isArray(form.components) || form.components.length !== 1) return null;
  const label = notionObject(form.components[0]);
  if (label.type !== 18) return null;
  const input = notionObject(label.component);
  if (input.type !== 4 || input.custom_id !== 'note' || typeof input.value !== 'string')
    return null;
  const text = input.value.trim();
  return text.length > 0 && text.length <= 1800 ? text : null;
}
