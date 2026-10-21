import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  saveTaskCheckinConfiguration,
  taskCheckinReview,
} from '@lasvegasfortransit/platform-storage/notion-task-admin';
import {
  inspectTaskCheckinPolicy,
  readTaskCheckinPolicy,
  type TaskCheckinPolicy,
} from './notion-task-policy';
import { notionObject } from './notion-task-types';
const POLICY_KEYS = [
  'guildId',
  'shareDescription',
  'rangeBoundary',
  'projectsSourceId',
  'projectLeadField',
  'timezone',
  'quietStartMinute',
  'quietEndMinute',
  'preDeadlineHours',
  'overdueHours',
  'followupHours',
  'digestHour',
  'snoozeMinutes',
  'notificationLimit24h',
  'notificationGapMinutes',
  'cancellationSignal',
  'contentApproved',
  'trialApproved',
  'cohortPersonIds',
  'serviceOwnerId',
  'supportPersonIds',
  'escalation',
  'escalateBlockers',
  'escalationContentApproved',
  'escalationAfterHours',
  'retentionDays',
  'successCriteria',
  'delivery',
];
function pick(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]),
  );
}
/** A paused draft preserves expected settings, never arbitrary credential-shaped fields. */
function policyDraft(value: unknown): Record<string, unknown> {
  const p = notionObject(value);
  return {
    ...pick(p, POLICY_KEYS),
    fields: pick(notionObject(p.fields), [
      'name',
      'description',
      'assignee',
      'due',
      'status',
      'project',
    ]),
    actions: pick(notionObject(p.actions), ['progress', 'blocker', 'complete', 'extension']),
  };
}
export async function configureTaskCheckins(
  db: Db,
  actor: Actor,
  input: {
    sourceId: string;
    workspaceId: string;
    expectedRevision: number;
    enabled: boolean;
    policy: unknown;
  },
  now: Date,
): Promise<{ kind: 'ok' | 'conflict' } | { kind: 'invalid'; gaps: string[] }> {
  const { source } = await taskCheckinReview(db, actor, input.sourceId);
  if (
    !input.sourceId.trim() ||
    input.sourceId.length > 200 ||
    !input.workspaceId.trim() ||
    input.workspaceId.length > 200 ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  )
    return { kind: 'invalid', gaps: ['configuration'] };
  const draft = policyDraft(input.policy),
    inspected = inspectTaskCheckinPolicy(draft);
  if ((input.enabled && !inspected.policy) || JSON.stringify(draft).length > 20_000)
    return { kind: 'invalid', gaps: inspected.gaps.length ? inspected.gaps : ['configuration'] };
  const saved = await saveTaskCheckinConfiguration(
    db,
    actor,
    {
      ...input,
      policy: inspected.policy ? { ...inspected.policy } : draft,
      preserveConsent: Boolean(
        source &&
        inspected.policy &&
        sameConsentPolicy(readTaskCheckinPolicy(source.policy_json), inspected.policy),
      ),
    },
    now,
  );
  return { kind: saved ? 'ok' : 'conflict' };
}

function sameConsentPolicy(previous: TaskCheckinPolicy | null, next: TaskCheckinPolicy): boolean {
  if (!previous) return false;
  const comparable = (policy: TaskCheckinPolicy) =>
    JSON.stringify({
      ...policy,
      cohortPersonIds: [...policy.cohortPersonIds].sort(),
      supportPersonIds: [...policy.supportPersonIds].sort(),
    });
  return comparable(previous) === comparable(next);
}
