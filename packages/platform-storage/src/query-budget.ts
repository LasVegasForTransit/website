import type { Db, Statement, SqlValue } from './db';

export class QueryBudgetExceeded extends Error {
  constructor() {
    super('Account query budget exceeded');
  }
}
export class D1QuotaExceeded extends Error {
  constructor() {
    super('D1 account quota exhausted');
    this.name = 'D1QuotaExceeded';
  }
}

export function isD1QuotaExceeded(error: unknown): boolean {
  for (let depth = 0; error instanceof Error && depth < 6; depth++, error = error.cause) {
    if (
      error instanceof D1QuotaExceeded ||
      error.name === 'D1QuotaExceeded' ||
      error.message === 'D1 account quota exhausted'
    )
      return true;
    if (
      /account has exceeded D1['’]s (?:free tier daily row (?:read|write)|maximum daily rows? (?:read|written)) limit/i.test(
        error.message,
      )
    )
      return true;
  }
  return false;
}

class Meter {
  queries = 0;
  largestBindings = 0;
  rowsRead = 0;
  rowsWritten = 0;
  metadataMissing = 0;
  quotaExhausted = false;
  databaseErrors = 0;
  constructor(
    readonly limit: number,
    readonly measureRows: boolean,
    readonly strictRows: boolean,
  ) {}
  assertAvailable(): void {
    if (this.quotaExhausted) throw new D1QuotaExceeded();
  }
  async execute<T>(run: () => Promise<T>): Promise<T> {
    this.assertAvailable();
    try {
      const result = await run();
      if (this.measureRows) {
        for (const item of Array.isArray(result) ? result : [result]) this.measure(item);
      }
      if (this.strictRows && this.metadataMissing)
        throw new Error('Missing scheduled database usage metadata');
      return result;
    } catch (error) {
      this.databaseErrors++;
      if (isD1QuotaExceeded(error)) {
        this.quotaExhausted = true;
        throw new D1QuotaExceeded();
      }
      throw error;
    }
  }
  measure(result: unknown): void {
    if (
      typeof result !== 'object' ||
      result === null ||
      !('meta' in result) ||
      typeof result.meta !== 'object' ||
      result.meta === null
    ) {
      this.metadataMissing++;
      return;
    }
    const meta = result.meta;
    const reads = 'rows_read' in meta ? meta.rows_read : undefined;
    const writes = 'rows_written' in meta ? meta.rows_written : undefined;
    if (
      typeof reads !== 'number' ||
      !Number.isSafeInteger(reads) ||
      reads < 0 ||
      typeof writes !== 'number' ||
      !Number.isSafeInteger(writes) ||
      writes < 0
    ) {
      this.metadataMissing++;
      return;
    }
    this.rowsRead += reads;
    this.rowsWritten += writes;
  }
  take(count: number): void {
    this.assertAvailable();
    if (this.queries + count > this.limit) throw new QueryBudgetExceeded();
    this.queries += count;
  }
}
class BudgetStatement implements Statement {
  constructor(
    readonly original: Statement,
    readonly meter: Meter,
  ) {}
  bind(...values: SqlValue[]): Statement {
    this.meter.largestBindings = Math.max(this.meter.largestBindings, values.length);
    if (values.length > 100) throw new QueryBudgetExceeded();
    return new BudgetStatement(this.original.bind(...values), this.meter);
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.meter.take(1);
    // D1 first() discards billing metadata; opt-in job metering keeps it.
    if (this.meter.measureRows)
      return (await this.meter.execute(() => this.original.all<T>())).results[0] ?? null;
    return await this.meter.execute(() => this.original.first<T>());
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors D1 row typing
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    this.meter.take(1);
    return await this.meter.execute(() => this.original.all<T>());
  }
  async run(): Promise<{ meta: { changes: number } }> {
    this.meter.take(1);
    return await this.meter.execute(() => this.original.run());
  }
}

/** Count each executed statement, including every statement in atomic batches. */
export function queryBudget(
  database: Db,
  limit = 50,
  options: { measureRows?: boolean; strictRows?: boolean } = {},
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Invalid account query budget');
  const meter = new Meter(
    limit,
    options.measureRows === true || options.strictRows === true,
    options.strictRows ?? false,
  );
  return {
    assertAvailable: () => meter.assertAvailable(),
    get usage() {
      return {
        queries: meter.queries,
        rows_read: meter.rowsRead,
        rows_written: meter.rowsWritten,
        metadata_missing: meter.metadataMissing,
        quota_exhausted: meter.quotaExhausted,
        database_errors: meter.databaseErrors,
      };
    },
    get queries() {
      return meter.queries;
    },
    get largestBindings() {
      return meter.largestBindings;
    },
    db: {
      prepare: (sql: string) => {
        meter.assertAvailable();
        return new BudgetStatement(database.prepare(sql), meter);
      },
      batch: async (statements: Statement[]) => {
        const originals = statements.map((statement) => {
          if (!(statement instanceof BudgetStatement) || statement.meter !== meter)
            throw new Error('Account batch requires its own statements');
          return statement.original;
        });
        meter.take(originals.length);
        return await meter.execute(() => database.batch(originals));
      },
    },
  };
}

export {
  reserveScheduledWork,
  settleScheduledWork,
  SCHEDULED_RESERVATION,
  SCHEDULED_CONTROL_ALLOWANCE,
  type ScheduledWorkLease,
  type ScheduledWorkUsage,
} from './scheduled-work-budget';
