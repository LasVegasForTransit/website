import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Db, Statement, SqlValue } from '@lasvegasfortransit/platform-storage/db';

class LocalStatement implements Statement {
  constructor(
    readonly raw: DatabaseSync,
    readonly sql: string,
    readonly values: SqlValue[] = [],
  ) {}
  bind(...values: SqlValue[]): Statement {
    return new LocalStatement(this.raw, this.sql, values);
  }
  first<T = Record<string, unknown>>(): Promise<T | null> {
    return Promise.resolve(
      (this.raw.prepare(this.sql).get(...this.values) as T | undefined) ?? null,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors the storage contract
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return Promise.resolve({ results: this.raw.prepare(this.sql).all(...this.values) as T[] });
  }
  run(): Promise<{ meta: { changes: number } }> {
    return Promise.resolve(this.execute());
  }
  execute() {
    const statement = this.raw.prepare(this.sql);
    return statement.columns().length
      ? { results: statement.all(...this.values), meta: { changes: 0 } }
      : { results: [], meta: { changes: Number(statement.run(...this.values).changes) } };
  }
}
export function localRosterDb(raw: DatabaseSync): Db {
  return {
    prepare: (sql) => new LocalStatement(raw, sql),
    batch: async (statements) => {
      raw.exec('BEGIN');
      try {
        const result = statements.map((statement) => {
          if (!(statement instanceof LocalStatement) || statement.raw !== raw)
            throw new Error('Foreign roster statement');
          return statement.execute();
        });
        raw.exec('COMMIT');
        return await Promise.resolve(result);
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
interface SchemaRow {
  type: string;
  name: string;
  sql: string;
}
interface TableRow {
  name: string;
  columns: string[];
}
function resultRows(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || !('results' in value) || !Array.isArray(value.results))
    throw new Error('Roster snapshot response invalid');
  return value.results as Record<string, unknown>[];
}
/** One read-only batch captures every application table together; no target SQL writes. */
export async function copyRosterDatabase(db: Db): Promise<DatabaseSync> {
  const schemaSql =
    "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name";
  const schema = (await db.prepare(schemaSql).all<SchemaRow>()).results;
  const tables: TableRow[] = [];
  for (const row of schema.filter((row) => row.type === 'table')) {
    const columns = (
      await db.prepare(`PRAGMA table_info(${quote(row.name)})`).all<{ name: string }>()
    ).results.map((column) => column.name);
    tables.push({ name: row.name, columns });
  }
  const result = await db.batch([
    db.prepare(schemaSql),
    ...tables.map((table) =>
      db.prepare(
        `SELECT ${table.columns
          .map(
            (column) =>
              `json_object('type',typeof(${quote(column)}),'value',CASE WHEN typeof(${quote(column)})='blob' THEN hex(${quote(column)}) ELSE ${quote(column)} END) AS ${quote(column)}`,
          )
          .join(',')} FROM ${quote(table.name)}`,
      ),
    ),
  ]);
  if (JSON.stringify(resultRows(result[0])) !== JSON.stringify(schema))
    throw new Error('Database schema changed; repeat the dry run');
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=OFF');
  try {
    for (const row of schema.filter((row) => row.type === 'table')) raw.exec(row.sql);
    for (const [index, table] of tables.entries()) {
      const insert = raw.prepare(
        `INSERT INTO ${quote(table.name)} (${table.columns.map(quote).join(',')}) VALUES (${table.columns.map(() => '?').join(',')})`,
      );
      for (const row of resultRows(result[index + 1]))
        insert.run(...table.columns.map((column) => decode(row[column])));
    }
    for (const row of schema.filter((row) => row.type !== 'table' && row.type !== 'view'))
      raw.exec(row.sql);
    for (const row of schema.filter((row) => row.type === 'view')) raw.exec(row.sql);
    raw.exec('PRAGMA foreign_keys=ON');
    if (raw.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Database snapshot has broken relationships');
    return raw;
  } catch (error) {
    raw.close();
    throw error;
  }
}
function decode(value: unknown): SQLInputValue {
  const cell: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!cell || typeof cell !== 'object' || !('type' in cell) || !('value' in cell))
    throw new Error('Invalid roster snapshot cell');
  if (cell.type === 'blob' && typeof cell.value === 'string') return Buffer.from(cell.value, 'hex');
  if (typeof cell.value === 'string' || typeof cell.value === 'number' || cell.value === null)
    return cell.value;
  throw new Error('Unsupported roster snapshot value');
}
