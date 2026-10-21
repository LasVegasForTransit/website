import type { NotionTaskSnapshot } from './notion-task-types';
import type { TaskCheckinPolicy } from './notion-task-policy';
import { taskDeadline, taskLocalClock } from './notion-task-time';
export { taskDeadline } from './notion-task-time';
export interface TaskReminder {
  kind: 'pre_deadline' | 'overdue' | 'followup';
  slot: string;
  scheduledAt: string;
}
export interface ReminderHistory {
  id: string;
  at: string;
  scheduledAt: string;
}
export function taskQuietNow(policy: TaskCheckinPolicy, now: Date): boolean {
  const local = taskLocalClock(now, policy.timezone);
  if (!local) return true;
  const { quietStartMinute: start, quietEndMinute: end } = policy;
  if (start === end) return false;
  return start < end
    ? local.minute >= start && local.minute < end
    : local.minute >= start || local.minute < end;
}
export function taskDigestDay(policy: TaskCheckinPolicy, now: Date): string | null {
  if (policy.digestHour === null || taskQuietNow(policy, now)) return null;
  const local = taskLocalClock(now, policy.timezone);
  return local && local.minute >= policy.digestHour * 60 ? local.day : null;
}
function followups(
  input: {
    policy: TaskCheckinPolicy;
    lastDelivery?: ReminderHistory | undefined;
    lastResponseAt?: string | null;
  },
  now: number,
): TaskReminder[] {
  const last = input.lastDelivery;
  if (!last || Date.parse(input.lastResponseAt ?? '') >= Date.parse(last.at)) return [];
  return input.policy.followupHours.flatMap((hours) => {
    const at = Date.parse(last.at) + hours * 3_600_000;
    return at <= now
      ? [
          {
            kind: 'followup' as const,
            slot: `followup:${last.id}:${hours}`,
            scheduledAt: new Date(at).toISOString(),
          },
        ]
      : [];
  });
}
/** Only the latest due slot is useful after a quiet period or outage; old slots never form a burst. */
export function selectTaskReminder(input: {
  task: NotionTaskSnapshot;
  policy: TaskCheckinPolicy;
  now: Date;
  snoozedUntil?: string | null;
  lastDelivery?: ReminderHistory | undefined;
  lastResponseAt?: string | null;
}): TaskReminder | null {
  const { task, policy, now } = input;
  if (
    task.status === 'Done' ||
    task.ineligibleReason ||
    !task.assigneeIds.length ||
    taskQuietNow(policy, now) ||
    Date.parse(input.snoozedUntil ?? '') > now.getTime()
  )
    return null;
  const due = taskDeadline(task, policy.timezone)?.getTime();
  if (due === undefined) return null;
  const before = now.getTime() <= due;
  const hours = before ? policy.preDeadlineHours : policy.overdueHours;
  const candidates: TaskReminder[] = hours.flatMap((hour) => {
    const at = due + (before ? -1 : 1) * hour * 3_600_000;
    return at <= now.getTime()
      ? [
          {
            kind: before ? ('pre_deadline' as const) : ('overdue' as const),
            slot: `${before ? 'pre' : 'overdue'}:${hour}`,
            scheduledAt: new Date(at).toISOString(),
          },
        ]
      : [];
  });
  candidates.push(...followups(input, now.getTime()));
  return (
    candidates.sort((a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt))[0] ?? null
  );
}
