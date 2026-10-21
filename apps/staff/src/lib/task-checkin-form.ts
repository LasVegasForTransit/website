import { field } from './forms';
function list(form: FormData, name: string): string[] {
  return form
    .getAll(name)
    .flatMap((value) => (typeof value === 'string' ? value.split(/[\s,]+/).filter(Boolean) : []))
    .slice(0, 500);
}
function minute(form: FormData, name: string): number {
  const value = field(form, name, 5);
  if (!/^\d{2}:\d{2}$/.test(value)) return -1;
  const [hour, minutes] = value.split(':').map(Number);
  return hour < 24 && minutes < 60 ? hour * 60 + minutes : -1;
}
export function taskPolicyFromForm(form: FormData): Record<string, unknown> {
  return {
    guildId: field(form, 'guildId', 30),
    fields: Object.fromEntries(
      ['name', 'description', 'assignee', 'due', 'status', 'project'].map((key) => [
        key,
        field(form, `field_${key}`, 100),
      ]),
    ),
    shareDescription: form.get('shareDescription') === 'on',
    rangeBoundary: field(form, 'rangeBoundary', 10),
    projectsSourceId: field(form, 'projectsSourceId', 64),
    projectLeadField: field(form, 'projectLeadField', 100),
    timezone: field(form, 'timezone', 100),
    quietStartMinute: minute(form, 'quietStart'),
    quietEndMinute: minute(form, 'quietEnd'),
    preDeadlineHours: list(form, 'preDeadlineHours').map(Number),
    overdueHours: list(form, 'overdueHours').map(Number),
    followupHours: list(form, 'followupHours').map(Number),
    digestHour: field(form, 'digestHour', 2) === '' ? null : Number(field(form, 'digestHour', 2)),
    snoozeMinutes: Number(field(form, 'snoozeMinutes', 6)),
    notificationLimit24h: Number(field(form, 'notificationLimit24h', 2)),
    notificationGapMinutes: Number(field(form, 'notificationGapMinutes', 4)),
    actions: Object.fromEntries(
      ['progress', 'blocker', 'complete', 'extension'].map((key) => [
        key,
        form.get(`action_${key}`) === 'on',
      ]),
    ),
    cancellationSignal: 'archive',
    contentApproved: form.get('contentApproved') === 'on',
    trialApproved: form.get('trialApproved') === 'on',
    cohortPersonIds: list(form, 'cohortPersonIds'),
    serviceOwnerId: field(form, 'serviceOwnerId', 200),
    supportPersonIds: list(form, 'supportPersonIds'),
    escalation: field(form, 'escalation', 20),
    escalateBlockers: form.get('escalateBlockers') === 'on',
    escalationContentApproved: form.get('escalationContentApproved') === 'on',
    escalationAfterHours:
      field(form, 'escalationAfterHours', 3) === ''
        ? null
        : Number(field(form, 'escalationAfterHours', 3)),
    retentionDays: Number(field(form, 'retentionDays', 3)),
    successCriteria: field(form, 'successCriteria', 2000),
    delivery: 'private_dm',
  };
}
export function taskClock(value: unknown): string {
  if (typeof value !== 'number' || value < 0 || value > 1439) return '';
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
