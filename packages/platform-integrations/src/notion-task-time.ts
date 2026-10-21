import type { NotionTaskSnapshot } from './notion-task-types';

function formatter(timezone: string) {
  if (!timezone) throw new Error('Missing timezone');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
function localParts(format: Intl.DateTimeFormat, instant: number) {
  const parts = format.formatToParts(instant);
  const n = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
}
/** Find real instants for a wall clock; a DST gap is invalid and a fold uses the later instant. */
function localInstant(wall: string, timezone: string): Date | null {
  const desired = Date.parse(`${wall}Z`);
  if (!Number.isFinite(desired)) return null;
  const format = formatter(timezone),
    candidates = new Set<number>();
  for (const shift of [-36, 0, 36]) {
    const sample = desired + shift * 3_600_000;
    const candidate = desired - (localParts(format, sample) - sample);
    if (localParts(format, candidate) === desired) candidates.add(candidate);
  }
  return candidates.size ? new Date(Math.max(...candidates)) : null;
}
export function taskDeadline(task: NotionTaskSnapshot, timezone: string): Date | null {
  try {
    formatter(timezone);
    const due = task.dueDate;
    if (!due) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      const next = new Date(`${due}T00:00:00Z`);
      if (!Number.isFinite(next.getTime()) || next.toISOString().slice(0, 10) !== due) return null;
      next.setUTCDate(next.getUTCDate() + 1);
      const boundary = localInstant(`${next.toISOString().slice(0, 10)}T00:00:00`, timezone);
      return boundary ? new Date(boundary.getTime() - 1) : null;
    }
    if (/(?:Z|[+-]\d{2}:\d{2})$/.test(due)) {
      const instant = new Date(due);
      return Number.isFinite(instant.getTime()) ? instant : null;
    }
    if (!task.dueTimeZone) return null;
    return localInstant(due.replace(/\.\d+$/, ''), task.dueTimeZone);
  } catch {
    return null;
  }
}
export function taskLocalClock(
  now: Date,
  timezone: string,
): { day: string; minute: number } | null {
  try {
    const local = new Date(localParts(formatter(timezone), now.getTime()));
    return {
      day: local.toISOString().slice(0, 10),
      minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
    };
  } catch {
    return null;
  }
}
