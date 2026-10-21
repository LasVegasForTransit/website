import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { readTaskCheckinSource } from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { ensureTaskCard } from '@lasvegasfortransit/platform-storage/notion-task-cards';
import {
  listTaskEscalationCandidates,
  noteTaskEscalationEvaluation,
  taskEscalationMappings,
  type EscalationCandidate,
} from '@lasvegasfortransit/platform-storage/notion-task-escalation-candidates';
import {
  queueTaskEscalation,
  type EscalationRecipient,
} from '@lasvegasfortransit/platform-storage/notion-task-escalations';
import {
  taskProviderCoolingDown,
  deferTaskProvider,
} from '@lasvegasfortransit/platform-storage/notion-task-provider-backoff';
import { NotionTaskApiError, type NotionTaskClient } from './notion-task-client';
import { readTaskCheckinPolicy, type TaskCheckinPolicy } from './notion-task-policy';
import { resolveNotionTaskEscalation } from './notion-task-projects';
import type { NotionTaskSnapshot } from './notion-task-types';
import { taskDeadline } from './notion-task-time';
export function overdueEscalationDue(
  task: NotionTaskSnapshot,
  policy: TaskCheckinPolicy,
  now: Date,
): boolean {
  const deadline = taskDeadline(task, policy.timezone);
  return Boolean(
    deadline &&
    policy.escalationAfterHours !== null &&
    deadline.getTime() + policy.escalationAfterHours * 3_600_000 <= now.getTime(),
  );
}
async function recipients(
  db: Db,
  notion: NotionTaskClient,
  input: { sourceId: string; task: NotionTaskSnapshot; policy: TaskCheckinPolicy },
): Promise<EscalationRecipient[]> {
  const { sourceId, task, policy } = input;
  if (policy.escalation === 'support')
    return policy.supportPersonIds.map((personId) => ({
      key: `person:${personId}`,
      personId,
      notionId: null,
    }));
  let leads;
  try {
    leads = await resolveNotionTaskEscalation(
      notion,
      task.projectIds,
      { ...policy, sourceId },
      new Map(),
    );
  } catch (error) {
    if (!(error instanceof NotionTaskApiError)) throw error;
    const limited =
      error.code === 'request_budget_exceeded' || error.code === 'property_budget_exceeded';
    return [
      {
        key: 'review:project',
        personId: null,
        notionId: null,
        reviewReason: limited ? 'routing_limit' : 'routing_provider_unavailable',
        retryAfterMs: Math.max(error.retryAfterMs, 60_000),
      },
    ];
  }
  const mapping = await taskEscalationMappings(db, sourceId, leads.escalationNotionIds);
  return [
    ...leads.escalationNotionIds.map((notionId) => ({
      key: `notion:${notionId}`,
      personId: mapping.get(notionId) ?? null,
      notionId,
    })),
    ...(leads.escalationNeedsReview
      ? [{ key: 'review:project', personId: null, notionId: null }]
      : []),
  ];
}
function eventReference(
  row: EscalationCandidate,
  task: NotionTaskSnapshot,
  policy: TaskCheckinPolicy,
  trigger: { trigger: 'blocker' | 'overdue'; blockerId: string | null },
): Promise<string> {
  const event =
    trigger.trigger === 'blocker'
      ? ['blocker', trigger.blockerId]
      : ['overdue', task.dueDate, task.dueTimeZone, policy.timezone];
  return digestToken(JSON.stringify([row.source_id, row.task_id, row.person_id, event]));
}
async function readyPolicy(db: Db, sourceId: string, now: Date) {
  const source = await readTaskCheckinSource(db, sourceId);
  if (!source?.enabled || (await taskProviderCoolingDown(db, sourceId, now))) return null;
  return readTaskCheckinPolicy(source.policy_json);
}
async function deferRouting(
  db: Db,
  sourceId: string,
  destinations: EscalationRecipient[],
  now: Date,
): Promise<boolean> {
  const unavailable = destinations.find(
    (recipient) => recipient.reviewReason === 'routing_provider_unavailable',
  );
  if (unavailable) {
    await deferTaskProvider(db, sourceId, unavailable.retryAfterMs ?? 60_000, now);
    return true;
  }
  return destinations.some((recipient) => recipient.reviewReason === 'routing_limit');
}
export async function queueTaskEscalations(
  db: Db,
  notion: NotionTaskClient,
  sourceId: string,
  clock: () => Date,
): Promise<number> {
  const policy = await readyPolicy(db, sourceId, clock());
  if (!policy) return 0;
  let evaluated = 0;
  for (const row of await listTaskEscalationCandidates(db, sourceId, clock())) {
    if (
      !(await ensureTaskCard(
        db,
        { sourceId, taskId: row.task_id, personId: row.person_id },
        clock(),
      ))
    )
      continue;
    await noteTaskEscalationEvaluation(db, row, clock());
    const task = JSON.parse(row.snapshot_json) as NotionTaskSnapshot;
    const triggers: { trigger: 'blocker' | 'overdue'; blockerId: string | null }[] = [];
    if (policy.escalateBlockers && row.blocker_id)
      triggers.push({ trigger: 'blocker', blockerId: row.blocker_id });
    if (overdueEscalationDue(task, policy, clock()))
      triggers.push({ trigger: 'overdue', blockerId: null });
    if (!triggers.length) continue;
    const destinations = await recipients(db, notion, { sourceId, task, policy });
    for (const trigger of triggers) {
      const eventKey = await eventReference(row, task, policy, trigger);
      await queueTaskEscalation(
        db,
        {
          eventKey,
          sourceId,
          taskId: row.task_id,
          subjectId: row.person_id,
          taskRevision: row.task_revision,
          consentRevision: row.consent_revision,
          policyRevision: row.policy_revision,
          ...trigger,
          recipients: destinations,
        },
        clock(),
      );
      evaluated++;
    }
    if (await deferRouting(db, sourceId, destinations, clock())) break;
  }
  return evaluated;
}
