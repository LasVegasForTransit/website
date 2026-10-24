import { t } from '@lasvegasfortransit/platform-core/messages';
import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';
import { notionObject, type NotionTaskFields } from './notion-task-types';

export interface TaskCheckinPolicy {
  guildId: string;
  fields: NotionTaskFields;
  shareDescription: boolean;
  rangeBoundary: 'reject' | 'start' | 'end';
  projectsSourceId: string;
  projectLeadField: string;
  timezone: string;
  quietStartMinute: number;
  quietEndMinute: number;
  preDeadlineHours: number[];
  overdueHours: number[];
  followupHours: number[];
  digestHour: number | null;
  snoozeMinutes: number;
  notificationLimit24h: number;
  notificationGapMinutes: number;
  actions: { progress: boolean; blocker: boolean; complete: boolean; extension: boolean };
  cancellationSignal: 'archive';
  contentApproved: true;
  trialApproved: true;
  cohortPersonIds: string[];
  serviceOwnerId: string;
  supportPersonIds: string[];
  escalation: 'project_leads' | 'support';
  escalateBlockers: boolean;
  escalationContentApproved: boolean;
  escalationAfterHours: number | null;
  retentionDays: number;
  successCriteria: string;
  delivery: 'private_dm';
}
function boundedText(value: unknown, length = 128): boolean {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= length &&
    !/[\r\n]/.test(value)
  );
}
function integer(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
function hours(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 10 &&
    value.every((hour: unknown) => integer(hour, 1, 720))
  );
}
function people(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 500 &&
    value.every((id: unknown) => boundedText(id))
  );
}
function timezone(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
function sourceReady(value: Record<string, unknown>): boolean {
  const fields = notionObject(value.fields);
  return (
    ['name', 'description', 'assignee', 'due', 'status', 'project'].every((key) =>
      boundedText(fields[key], 100),
    ) &&
    typeof value.shareDescription === 'boolean' &&
    ['reject', 'start', 'end'].some((option) => option === value.rangeBoundary) &&
    isDiscordId(value.guildId) &&
    value.cancellationSignal === 'archive'
  );
}
function timingReady(v: Record<string, unknown>): boolean {
  return (
    timezone(v.timezone) &&
    integer(v.quietStartMinute, 0, 1439) &&
    integer(v.quietEndMinute, 0, 1439) &&
    hours(v.preDeadlineHours) &&
    hours(v.overdueHours) &&
    hours(v.followupHours) &&
    (v.digestHour === null || integer(v.digestHour, 0, 23)) &&
    integer(v.snoozeMinutes, 15, 10080)
  );
}
function notificationScheduleReady(v: Record<string, unknown>): boolean {
  return (
    integer(v.digestHour, 0, 23) ||
    (Array.isArray(v.preDeadlineHours) && v.preDeadlineHours.length > 0) ||
    (Array.isArray(v.overdueHours) && v.overdueHours.length > 0)
  );
}
function actionsReady(value: unknown): boolean {
  const actions = notionObject(value);
  return ['progress', 'blocker', 'complete', 'extension'].every(
    (key) => typeof actions[key] === 'boolean',
  );
}
function escalationReady(v: Record<string, unknown>): boolean {
  if (
    !people(v.supportPersonIds) ||
    typeof v.escalateBlockers !== 'boolean' ||
    typeof v.escalationContentApproved !== 'boolean' ||
    !(v.escalationAfterHours === null || integer(v.escalationAfterHours, 1, 720))
  )
    return false;
  if ((v.escalateBlockers || v.escalationAfterHours !== null) && !v.escalationContentApproved)
    return false;
  return (
    v.escalation === 'support' ||
    (v.escalation === 'project_leads' &&
      boundedText(v.projectsSourceId, 64) &&
      boundedText(v.projectLeadField, 100))
  );
}
export function inspectTaskCheckinPolicy(value: unknown): {
  policy: TaskCheckinPolicy | null;
  gaps: string[];
} {
  const v = notionObject(value);
  const checks: [string, boolean][] = [
    ['source', sourceReady(v)],
    ['timing', timingReady(v)],
    ['cadence', notificationScheduleReady(v)],
    [
      'notification_limits',
      integer(v.notificationLimit24h, 1, 20) && integer(v.notificationGapMinutes, 1, 1440),
    ],
    ['actions', actionsReady(v.actions)],
    ['content_approval', v.contentApproved === true],
    ['trial_approval', v.trialApproved === true],
    ['cohort', people(v.cohortPersonIds)],
    ['service_owner', boundedText(v.serviceOwnerId)],
    ['support', escalationReady(v)],
    ['retention', integer(v.retentionDays, 1, 365)],
    ['success_criteria', boundedText(v.successCriteria, 2000)],
    ['private_delivery', v.delivery === 'private_dm'],
  ];
  const gaps = checks.filter(([, valid]) => !valid).map(([key]) => key);
  if (gaps.length) return { policy: null, gaps };
  const p = value as TaskCheckinPolicy;
  return {
    gaps,
    policy: {
      guildId: p.guildId,
      fields: {
        name: p.fields.name,
        description: p.fields.description,
        assignee: p.fields.assignee,
        due: p.fields.due,
        status: p.fields.status,
        project: p.fields.project,
      },
      shareDescription: p.shareDescription,
      rangeBoundary: p.rangeBoundary,
      projectsSourceId: p.projectsSourceId,
      projectLeadField: p.projectLeadField,
      timezone: p.timezone,
      quietStartMinute: p.quietStartMinute,
      quietEndMinute: p.quietEndMinute,
      preDeadlineHours: [...new Set(p.preDeadlineHours)].sort((a, b) => b - a),
      overdueHours: [...new Set(p.overdueHours)].sort((a, b) => a - b),
      followupHours: [...new Set(p.followupHours)].sort((a, b) => a - b),
      digestHour: p.digestHour,
      snoozeMinutes: p.snoozeMinutes,
      notificationLimit24h: p.notificationLimit24h,
      notificationGapMinutes: p.notificationGapMinutes,
      actions: {
        progress: p.actions.progress,
        blocker: p.actions.blocker,
        complete: p.actions.complete,
        extension: p.actions.extension,
      },
      cancellationSignal: 'archive',
      contentApproved: true,
      trialApproved: true,
      cohortPersonIds: [...new Set(p.cohortPersonIds)],
      serviceOwnerId: p.serviceOwnerId,
      supportPersonIds: [...new Set(p.supportPersonIds)],
      escalation: p.escalation,
      escalateBlockers: p.escalateBlockers,
      escalationContentApproved: p.escalationContentApproved,
      escalationAfterHours: p.escalationAfterHours,
      retentionDays: p.retentionDays,
      successCriteria: p.successCriteria,
      delivery: 'private_dm',
    },
  };
}
export function readTaskCheckinPolicy(json: string): TaskCheckinPolicy | null {
  try {
    return inspectTaskCheckinPolicy(JSON.parse(json) as unknown).policy;
  } catch {
    return null;
  }
}
function clockMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
export function taskCheckinScheduleSummary(p: TaskCheckinPolicy): string {
  const lines = [
    t('taskCheckins.dateOnlySchedule', { timezone: p.timezone }),
    t('taskCheckins.notificationLimits', {
      count: p.notificationLimit24h,
      minutes: p.notificationGapMinutes,
    }),
    ...(p.preDeadlineHours.length
      ? [t('taskCheckins.beforeSchedule', { hours: p.preDeadlineHours.join(', ') })]
      : []),
    ...(p.overdueHours.length
      ? [t('taskCheckins.afterSchedule', { hours: p.overdueHours.join(', ') })]
      : []),
    ...(p.followupHours.length
      ? [t('taskCheckins.followupSchedule', { hours: p.followupHours.join(', ') })]
      : []),
    ...(p.digestHour === null ? [] : [t('taskCheckins.digestSchedule', { hour: p.digestHour })]),
    p.quietStartMinute === p.quietEndMinute
      ? t('taskCheckins.anytimeSchedule', { timezone: p.timezone })
      : t('taskCheckins.quietSchedule', {
          start: clockMinute(p.quietStartMinute),
          end: clockMinute(p.quietEndMinute),
          timezone: p.timezone,
        }),
    ...(p.escalateBlockers ? [t('taskCheckins.blockerEscalationSchedule')] : []),
    ...(p.escalationAfterHours === null
      ? []
      : [t('taskCheckins.overdueEscalationSchedule', { hours: p.escalationAfterHours })]),
    p.escalation === 'project_leads'
      ? t('taskCheckins.leadSupport')
      : t('taskCheckins.staffSupport'),
    t('taskCheckins.historyRetention', { days: p.retentionDays }),
  ];
  return lines.join('\n');
}
