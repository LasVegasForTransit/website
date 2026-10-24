import { notionObject } from './notion-task-types';

export type TaskStatus = 'Not started' | 'In progress' | 'Done';
export function taskStatus(value: unknown): TaskStatus | null {
  return value === 'Not started' || value === 'In progress' || value === 'Done' ? value : null;
}
export function taskStatusSelection(data: unknown): TaskStatus | null {
  const row = notionObject(data);
  return row.component_type === 3 && Array.isArray(row.values) && row.values.length === 1
    ? taskStatus(row.values[0])
    : null;
}
export function taskStatusTarget(payload: unknown): TaskStatus | null {
  const value = notionObject(payload).status;
  return value === undefined ? 'Done' : taskStatus(value);
}
