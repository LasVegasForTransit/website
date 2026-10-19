import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';

/** Retain database failure state even when a provider converts an error into a retry. */
export async function runMeteredJob<T extends object>(
  database: Db,
  job: string,
  run: (budget: ReturnType<typeof queryBudget>) => Promise<T>,
): Promise<T & { databaseUsage: ReturnType<typeof queryBudget>['usage'] }> {
  const budget = queryBudget(database, 50, { measureRows: true });
  try {
    const result = await run(budget);
    return { ...result, databaseUsage: budget.usage };
  } finally {
    console.log(JSON.stringify({ event: 'job_database_usage', job, ...budget.usage }));
    budget.assertAvailable();
  }
}

export function idleDatabaseJob<T extends object>(result: T) {
  return {
    ...result,
    databaseUsage: {
      queries: 0,
      rows_read: 0,
      rows_written: 0,
      metadata_missing: 0,
      database_errors: 0,
      quota_exhausted: false,
    },
  };
}
