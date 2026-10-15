import type { Db, Statement, SqlValue } from '@lasvegasfortransit/platform-storage/db';
interface Query {
  sql: string;
  params: SqlValue[];
}
interface Result {
  results: Record<string, unknown>[];
  meta: { changes: number };
  success: boolean;
}
class RemoteStatement implements Statement {
  constructor(
    readonly owner: RosterD1,
    readonly query: Query,
  ) {}
  bind(...params: SqlValue[]): Statement {
    return new RemoteStatement(this.owner, { ...this.query, params });
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (await this.all<T>()).results[0] ?? null;
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors the storage contract
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: ((await this.owner.execute([this.query]))[0]?.results ?? []) as T[] };
  }
  async run(): Promise<{ meta: { changes: number } }> {
    const result = (await this.owner.execute([this.query]))[0];
    if (!result) throw new Error('D1 import statement did not return a result');
    return result;
  }
}
/** The documented D1 query batch preserves the storage service's transaction boundary. */
export class RosterD1 implements Db {
  constructor(
    private readonly config: {
      accountId: string;
      databaseId: string;
      token: string;
      write: boolean;
    },
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (
      !/^[a-f0-9]{32}$/i.test(config.accountId) ||
      !/^[a-f0-9-]{36}$/i.test(config.databaseId) ||
      !config.token.trim()
    )
      throw new Error('D1 import configuration is incomplete');
  }
  prepare(sql: string): Statement {
    return new RemoteStatement(this, { sql, params: [] });
  }
  async batch(statements: Statement[]): Promise<unknown[]> {
    return await this.execute(
      statements.map((statement) => {
        if (!(statement instanceof RemoteStatement) || statement.owner !== this)
          throw new Error('Foreign D1 import statement');
        return statement.query;
      }),
    );
  }
  async execute(batch: Query[]): Promise<Result[]> {
    if (!batch.length) return [];
    if (
      !this.config.write &&
      batch.some((query) => !/^\s*(SELECT\b|PRAGMA table_info\()/i.test(query.sql))
    )
      throw new Error('Dry-run connection refuses database writes');
    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/d1/database/${this.config.databaseId}/query`,
        {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(30_000),
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ batch }),
        },
      );
    } catch {
      throw new Error('D1 import connection failed; no credentials or source data are printed');
    }
    if (!response.ok) throw new Error(`D1 import request failed (HTTP ${response.status})`);
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('success' in body) ||
      body.success !== true ||
      !('result' in body) ||
      !Array.isArray(body.result) ||
      body.result.length !== batch.length
    )
      throw new Error('D1 import returned an invalid batch');
    const results = body.result as Result[];
    if (results.some((result) => !result.success || !Array.isArray(result.results)))
      throw new Error('D1 import batch failed; save the private report and repeat the dry run');
    return results;
  }
}
