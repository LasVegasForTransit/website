import type { Db, Statement, SqlValue } from './db';

export class QueryBudgetExceeded extends Error {
  constructor() {
    super('Account query budget exceeded');
  }
}
class Meter {
  queries = 0;
  largestBindings = 0;
  constructor(readonly limit: number) {}
  take(count: number): void {
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
    return await this.original.first<T>();
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors D1 row typing
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    this.meter.take(1);
    return await this.original.all<T>();
  }
  async run(): Promise<{ meta: { changes: number } }> {
    this.meter.take(1);
    return await this.original.run();
  }
}

/** Count each executed statement, including every statement in atomic batches. */
export function queryBudget(
  database: Db,
  limit = 50,
): { db: Db; readonly queries: number; readonly largestBindings: number } {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Invalid account query budget');
  const meter = new Meter(limit);
  return {
    get queries() {
      return meter.queries;
    },
    get largestBindings() {
      return meter.largestBindings;
    },
    db: {
      prepare: (sql) => new BudgetStatement(database.prepare(sql), meter),
      batch: async (statements) => {
        const originals = statements.map((statement) => {
          if (!(statement instanceof BudgetStatement) || statement.meter !== meter)
            throw new Error('Account batch requires its own statements');
          return statement.original;
        });
        meter.take(originals.length);
        return await database.batch(originals);
      },
    },
  };
}
