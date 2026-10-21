import { membershipStep, canContinueMembership, type ScheduledBudget } from './scheduled-budget';
/** Each task step gets one bounded invocation; provider completion keeps its reserved slot. */
export async function runScheduledTaskCheckins(
  context: ExecutionContext,
  budget: ScheduledBudget,
): Promise<boolean> {
  let failed = false;
  const steps = [
    ['task_checkin_commands', () => context.exports.TaskCheckinCommands.run()],
    ['task_checkin_scan', () => context.exports.TaskCheckinScan.run()],
    ['task_checkin_queue', () => context.exports.TaskCheckinQueue.run()],
    ['task_checkin_operation', () => context.exports.TaskCheckinOperation.run()],
    ['task_checkin_recovery', () => context.exports.TaskCheckinRecovery.run()],
    ['task_checkin_escalation', () => context.exports.TaskCheckinEscalation.run()],
    ['task_checkin_refresh', () => context.exports.TaskCheckinRefresh.run()],
    ['task_checkin_digest', () => context.exports.TaskCheckinDigest.run()],
  ] as const;
  for (const [event, run] of steps) {
    if (!canContinueMembership(budget)) break;
    const result = await membershipStep<{ kind: string }>(budget, event, run);
    if (!result || result.kind === 'failed') failed = true;
  }
  return failed;
}
