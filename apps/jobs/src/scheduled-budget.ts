import { scheduledStep } from './scheduled-step';

export interface ScheduledBudget {
  remaining: number;
  deadline: number;
}

/** Count every loopback invocation; the caller reserves one for completion. */
export async function membershipStep<T extends object>(
  budget: ScheduledBudget,
  event: string,
  run: () => Promise<T>,
): Promise<T | null> {
  if (budget.remaining <= 0) throw new Error('Scheduled invocation budget exceeded');
  budget.remaining--;
  return await scheduledStep(event, run);
}

export function canContinueMembership(budget: ScheduledBudget): boolean {
  return budget.remaining > 1 && Date.now() < budget.deadline;
}
