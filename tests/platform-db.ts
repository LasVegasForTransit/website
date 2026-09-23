// An in-memory SQLite database with the platform migrations applied, shaped
// like Cloudflare D1, so storage code runs in tests exactly as in production.

import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Db, SqlValue, Statement } from '../platform/storage/db';

const MIGRATIONS = new URL('../platform/storage/migrations/', import.meta.url);

class MemoryStatement implements Statement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: SqlValue[] = [],
  ) {}

  bind(...values: SqlValue[]): Statement {
    return new MemoryStatement(this.database, this.sql, values);
  }

  first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.database.prepare(this.sql).get(...(this.values as SQLInputValue[]));
    return Promise.resolve((row as T | undefined) ?? null);
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors D1's signature
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rows = this.database.prepare(this.sql).all(...(this.values as SQLInputValue[]));
    return Promise.resolve({ results: rows as T[] });
  }

  run(): Promise<{ meta: { changes: number } }> {
    const result = this.database.prepare(this.sql).run(...(this.values as SQLInputValue[]));
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }
}

export interface MemoryDb extends Db {
  raw: DatabaseSync;
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

export function memoryDb(): MemoryDb {
  const raw = new DatabaseSync(':memory:');
  for (const file of migrationFiles()) raw.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  return {
    raw,
    prepare: (sql) => new MemoryStatement(raw, sql),
    batch: async (statements) => {
      raw.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec('COMMIT');
        return results;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

/** Every text value in every table, for checking that something was never stored. */
export function everyStoredText(db: MemoryDb): string {
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
    name: string;
  }[];
  return tables
    .map(({ name }) => JSON.stringify(db.raw.prepare(`SELECT * FROM "${name}"`).all()))
    .join('\n');
}
