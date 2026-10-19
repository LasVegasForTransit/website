import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';

/** Retain database failure state even when a provider converts an error into a retry. */
export async function runMeteredJob<T>(
  database: Db,
  job: string,
  run: (budget: ReturnType<typeof queryBudget>) => Promise<T>,
): Promise<T> {
  const budget = queryBudget(database, 50, { measureRows: true });
  try {
    return await run(budget);
  } finally {
    console.log(JSON.stringify({ event: 'job_database_usage', job, ...budget.usage }));
    budget.assertAvailable();
  }
}
