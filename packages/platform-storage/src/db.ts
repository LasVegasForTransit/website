// The part of Cloudflare D1's interface the storage package uses. Cloudflare's
// D1Database satisfies it in production, and the tests satisfy it with an
// in-memory SQLite database, so storage code runs unchanged in both.

export type SqlValue = string | number | null;

// The row type parameters mirror D1's own signatures, so a D1Database
// satisfies this interface without a wrapper.
export interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors D1's signature
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface Db {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
