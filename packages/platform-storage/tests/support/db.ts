// An in-memory SQLite database with the platform migrations applied, shaped
// like Cloudflare D1, so storage code runs in tests exactly as in production.

import { readFileSync, readdirSync } from 'node:fs';
import { URL } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Db, SqlValue, Statement } from '@lasvegasfortransit/platform-storage/db';
import { workScopeKey } from '../../src/discord-work-types';
import type { WorkRoute } from '../../src/discord-work-routes';

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
    const before = this.database.prepare('SELECT total_changes() AS n').get()?.n;
    this.database.prepare(this.sql).run(...(this.values as SQLInputValue[]));
    const after = this.database.prepare('SELECT total_changes() AS n').get()?.n;
    // D1 counts trigger writes in addition to the statement's direct changes.
    return { meta: { changes: Number(after) - Number(before) } };
  }
}

export interface MemoryDb extends Db {
  raw: DatabaseSync;
}

/** Seed an already-active route when testing consumers, not the activation flow. */
export function seedActiveWorkRoute(db: MemoryDb, route: WorkRoute, now: Date): void {
  if (route.state !== 'active') throw new Error('Expected an active route fixture');
  const source = route.sourceId.replaceAll('-', '').toLowerCase();
  db.raw
    .prepare(
      `INSERT INTO discord_work_routes(id,scope_key,source_id,state,revision,data_json,updated_at)
    VALUES(?,?,?,'active',?,?,?) ON CONFLICT(id) DO UPDATE SET scope_key=excluded.scope_key,
    source_id=excluded.source_id,state=excluded.state,revision=excluded.revision,
    data_json=excluded.data_json,updated_at=excluded.updated_at`,
    )
    .run(
      route.id,
      workScopeKey(route.scope),
      source,
      route.revision,
      JSON.stringify({ ...route, sourceId: source }),
      now.toISOString(),
    );
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
