import type { Db, Statement, SqlValue } from '@lasvegasfortransit/platform-storage/db';
// SQLite has no D1 billing metadata. This fixture supplies deterministic metadata
// to exercise the budget boundary; provider-cost acceptance uses real D1 metadata.
class MetadataStatement implements Statement {
  constructor(readonly original: Statement) {}
  bind(...values: SqlValue[]): Statement {
    return new MetadataStatement(this.original.bind(...values));
  }
  first<T = Record<string, unknown>>() {
    return this.original.first<T>();
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors D1 row typing
  async all<T = Record<string, unknown>>(): Promise<{
    results: T[];
    meta: { rows_read: number; rows_written: number };
  }> {
    const result = await this.original.all<T>();
    return { ...result, meta: { rows_read: Math.max(1, result.results.length), rows_written: 0 } };
  }
  async run() {
    const result = await this.original.run();
    return { ...result, meta: { ...result.meta, rows_read: 1, rows_written: result.meta.changes } };
  }
}
export function workspaceDb(database: Db): Db {
  return {
    prepare: (sql) => new MetadataStatement(database.prepare(sql)),
    batch: async (statements) => {
      const results = await database.batch(
        statements.map((s) => {
          if (!(s instanceof MetadataStatement)) throw new Error('Wrong fixture statement');
          return s.original;
        }),
      );
      return results.map((value) => {
        const result = value as { meta: { changes: number }; results?: unknown[] };
        return {
          ...result,
          meta: {
            ...result.meta,
            rows_read: Math.max(1, result.results?.length ?? 0),
            rows_written: result.meta.changes,
          },
        };
      });
    },
  };
}
