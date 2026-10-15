import assert from 'node:assert/strict';
import type { SQLInputValue } from 'node:sqlite';
import { memoryDb, type MemoryDb } from './db';

function historicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(historicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      key === 'membership_rules_version' && nested === 2 ? 1 : historicalValue(nested),
    ]),
  );
}

/**
 * Seed with today's fixture helpers, then copy only the historical schema's
 * columns into a fresh canonical database. The upgrade itself therefore starts
 * without later tables, triggers or membership rules. Existing consent-backed
 * fixture members retain the historical rule in people and merge archives.
 */
export function useHistoricalMembershipSchema(db: MemoryDb, through: string): void {
  const target = memoryDb(through);
  const triggers = target.raw
    .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'")
    .all();
  const tables = target.raw
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('d1_migrations','membership_rules','sqlite_sequence')",
    )
    .all();
  target.raw.exec('PRAGMA foreign_keys=OFF; BEGIN');
  try {
    for (const trigger of triggers) target.raw.exec(`DROP TRIGGER "${String(trigger.name)}"`);
    for (const table of tables) {
      const name = String(table.name);
      const columns = target.raw
        .prepare(`PRAGMA table_info("${name}")`)
        .all()
        .map((column) => String(column.name));
      const names = columns.map((column) => `"${column}"`).join(',');
      const selection = columns
        .map((column) =>
          name === 'provider_backoffs' && column === 'application_id'
            ? 'context_id AS application_id'
            : `"${column}"`,
        )
        .join(',');
      const rows = db.raw.prepare(`SELECT ${selection} FROM "${name}"`).all();
      target.raw.exec(`DELETE FROM "${name}"`);
      const insert = target.raw.prepare(
        `INSERT INTO "${name}"(${names}) VALUES(${columns.map(() => '?').join(',')})`,
      );
      for (const row of rows) {
        if (name === 'people' && row.membership_rules_version === 2)
          row.membership_rules_version = 1;
        if (name === 'merges' && typeof row.moved_rows === 'string')
          row.moved_rows = JSON.stringify(historicalValue(JSON.parse(row.moved_rows)));
        insert.run(...columns.map((column) => row[column] as SQLInputValue));
      }
    }
    for (const trigger of triggers) target.raw.exec(String(trigger.sql));
    target.raw.exec('COMMIT; PRAGMA foreign_keys=ON');
    assert.deepEqual(target.raw.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(
      target.raw
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='membership_roll'")
        .get()?.n,
      0,
    );
    assert.equal(target.raw.prepare('SELECT max(version) AS n FROM membership_rules').get()?.n, 1);
  } catch (error) {
    target.raw.close();
    throw error;
  }
  db.raw.close();
  Object.assign(db, target);
}
