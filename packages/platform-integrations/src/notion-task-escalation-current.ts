import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  readTaskEscalationContext,
  type TaskEscalation,
  type TaskEscalationContext,
} from '@lasvegasfortransit/platform-storage/notion-task-escalations';
import type { NotionTaskClient } from './notion-task-client';
import { readTaskCheckinPolicy } from './notion-task-policy';
import { hydrateNotionTask } from './notion-task-hydrate';
import { parseNotionTaskPage } from './notion-task-reader';
import { sameTaskSnapshot } from './notion-task-current';
import { resolveNotionTaskEscalation } from './notion-task-projects';
import { overdueEscalationDue } from './notion-task-escalation-queue';
function currentTask(
  parsed: ReturnType<typeof parseNotionTaskPage>,
  context: TaskEscalationContext,
  claim: TaskEscalation,
): parsed is NonNullable<ReturnType<typeof parseNotionTaskPage>> {
  return (
    parsed?.active === true &&
    parsed.taskId.replaceAll('-', '') === claim.task_id.replaceAll('-', '') &&
    sameTaskSnapshot(context.snapshot_json, parsed.snapshot) &&
    parsed.sourceEditedAt === context.source_edited_at &&
    parsed.snapshot.assigneeIds.includes(context.notion_user_id)
  );
}
function changedTask(
  parsed: ReturnType<typeof parseNotionTaskPage>,
  context: TaskEscalationContext,
) {
  return parsed?.active && parsed.snapshot.assigneeIds.includes(context.notion_user_id)
    ? { kind: 'review' as const, reason: 'task_changed' }
    : null;
}
export async function readCurrentEscalation(
  db: Db,
  notion: NotionTaskClient,
  claim: TaskEscalation,
  clock: () => Date,
) {
  const context = await readTaskEscalationContext(db, claim, clock()),
    policy = context && readTaskCheckinPolicy(context.policy_json);
  if (!context || !policy) return null;
  const hydrated = await hydrateNotionTask(notion, await notion.readPage(claim.task_id), {
    ...policy,
    sourceId: claim.source_id,
  });
  const parsed = parseNotionTaskPage(hydrated.page, hydrated.options);
  if (!currentTask(parsed, context, claim)) {
    return changedTask(parsed, context);
  }
  if (
    claim.trigger_kind === 'blocker'
      ? !policy.escalateBlockers
      : !overdueEscalationDue(parsed.snapshot, policy, clock())
  )
    return null;
  if (policy.escalation === 'project_leads') {
    const leads = await resolveNotionTaskEscalation(
      notion,
      parsed.snapshot.projectIds,
      { ...policy, sourceId: claim.source_id },
      new Map(),
    );
    if (
      !claim.recipient_notion_id ||
      !leads.escalationNotionIds.includes(claim.recipient_notion_id)
    )
      return { kind: 'review' as const, reason: 'project_lead_changed' };
  }
  const latest = await readTaskEscalationContext(db, claim, clock());
  if (
    latest?.policy_json !== context.policy_json ||
    latest.discord_user_id !== context.discord_user_id ||
    latest.subject_discord_user_id !== context.subject_discord_user_id ||
    latest.notion_user_id !== context.notion_user_id
  )
    return null;
  return { kind: 'ready' as const, context, policy, task: parsed.snapshot };
}
