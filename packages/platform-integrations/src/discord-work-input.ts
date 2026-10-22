import { notionObject } from './notion-task-types';
import type { WorkSubject } from './discord-work-types';
export function notionWorkId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.replaceAll('-', '').toLowerCase();
  return /^[a-f0-9]{32}$/.test(hex)
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : null;
}
export function notionWorkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1000) return null;
  try {
    const u = new URL(value);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      !['notion.so', 'www.notion.so', 'app.notion.com'].includes(u.hostname)
    )
      return null;
    const match = /(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|[a-f0-9]{32})$/i.exec(u.pathname);
    return notionWorkId(match?.[0]);
  } catch {
    return null;
  }
}
export function workSubject(value: unknown): WorkSubject | null {
  const r = notionObject(value),
    sourceId = notionWorkId(r.sourceId),
    pageId = notionWorkId(r.pageId);
  if (!sourceId || !pageId || !['task', 'project_plan', 'event_plan'].includes(String(r.kind)))
    return null;
  return { kind: r.kind as WorkSubject['kind'], sourceId, pageId };
}
export function workString(value: unknown, max = 256): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}
