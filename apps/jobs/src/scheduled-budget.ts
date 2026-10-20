import { scheduledStep } from './scheduled-step';
import {
  SCHEDULED_RESERVATION,
  type ScheduledWorkUsage,
} from '@lasvegasfortransit/platform-storage/query-budget';

export class ScheduledWorkDeferred extends Error {
  constructor() {
    super('Scheduled database work deferred');
  }
}
export interface ScheduledBudget {
  remaining: number;
  more?: boolean;
  controlUsage?: () => ScheduledWorkUsage;
  deadline: number;
  usage: ScheduledWorkUsage;
  controlReads: number;
  controlWrites: number;
}
export function emptyScheduledUsage(): ScheduledWorkUsage {
  return {
    rows_read: 0,
    rows_written: 0,
    metadata_missing: 0,
    database_errors: 0,
    quota_exhausted: false,
  };
}
function available(budget: ScheduledBudget): boolean {
  const control = budget.controlUsage?.();
  return (
    !control?.metadata_missing &&
    !control?.database_errors &&
    !control?.quota_exhausted &&
    budget.usage.rows_read + (control?.rows_read ?? 0) + budget.controlReads <
      SCHEDULED_RESERVATION.reads &&
    budget.usage.rows_written + (control?.rows_written ?? 0) + budget.controlWrites <
      SCHEDULED_RESERVATION.writes
  );
}
function jobUsage(result: object): ScheduledWorkUsage | null {
  if (
    !('databaseUsage' in result) ||
    typeof result.databaseUsage !== 'object' ||
    result.databaseUsage === null
  )
    return null;
  const usage = result.databaseUsage;
  if (
    !('rows_read' in usage) ||
    !('rows_written' in usage) ||
    !('metadata_missing' in usage) ||
    !('database_errors' in usage) ||
    !('quota_exhausted' in usage)
  )
    return null;
  if (
    ![usage.rows_read, usage.rows_written, usage.metadata_missing, usage.database_errors].every(
      (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    ) ||
    typeof usage.quota_exhausted !== 'boolean'
  )
    return null;
  return usage as ScheduledWorkUsage;
}

/** Account only confirmed child telemetry; absent RPC results never release a reservation. */
export async function membershipStep<T extends object>(
  budget: ScheduledBudget,
  event: string,
  run: () => Promise<T>,
): Promise<T | null> {
  if (budget.remaining <= 0) throw new Error('Scheduled invocation budget exceeded');
  if (!available(budget)) throw new ScheduledWorkDeferred();
  budget.remaining--;
  const result = await scheduledStep(event, run);
  const usage = result ? jobUsage(result) : null;
  if (!usage) {
    budget.usage.metadata_missing++;
    throw new ScheduledWorkDeferred();
  }
  budget.usage.rows_read += usage.rows_read;
  budget.usage.rows_written += usage.rows_written;
  budget.usage.metadata_missing += usage.metadata_missing;
  budget.usage.database_errors += usage.database_errors;
  budget.usage.quota_exhausted ||= usage.quota_exhausted;
  if (usage.metadata_missing || usage.database_errors || usage.quota_exhausted)
    throw new ScheduledWorkDeferred();
  return result;
}
export function canContinueMembership(budget: ScheduledBudget): boolean {
  return budget.remaining > 1 && Date.now() < budget.deadline && available(budget);
}
