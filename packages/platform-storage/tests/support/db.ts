// An in-memory SQLite database with the platform migrations applied, shaped
// like Cloudflare D1, so storage code runs in tests exactly as in production.

import { readFileSync, readdirSync } from 'node:fs';
import { URL } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Db, SqlValue, Statement } from '@lasvegasfortransit/platform-storage/db';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

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
    return Promise.resolve(this.runSync());
  }

  runSync(): { meta: { changes: number }; results?: Record<string, unknown>[] } {
    const prepared = this.database.prepare(this.sql);
    if (prepared.columns().length)
      return { meta: { changes: 0 }, results: prepared.all(...(this.values as SQLInputValue[])) };
    const result = this.database.prepare(this.sql).run(...(this.values as SQLInputValue[]));
    return { meta: { changes: Number(result.changes) } };
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

export function applyMigrations(raw: DatabaseSync, through?: string): void {
  raw.exec('CREATE TABLE IF NOT EXISTS d1_migrations (name TEXT PRIMARY KEY)');
  for (const file of migrationFiles()) {
    if (through && file > through) break;
    if (raw.prepare('SELECT name FROM d1_migrations WHERE name = ?').get(file)) continue;
    raw.exec('BEGIN');
    try {
      raw.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
      raw.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(file);
      raw.exec('COMMIT');
    } catch (error) {
      raw.exec('ROLLBACK');
      throw error;
    }
  }
}

export function memoryDb(through?: string): MemoryDb {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  applyMigrations(raw, through);
  return {
    raw,
    prepare: (sql) => new MemoryStatement(raw, sql),
    batch: async (statements) => {
      raw.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          if (!(statement instanceof MemoryStatement))
            throw new Error("Batch requires this database's prepared statements");
          results.push(statement.runSync());
        }
        raw.exec('COMMIT');
        return await Promise.resolve(results);
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
