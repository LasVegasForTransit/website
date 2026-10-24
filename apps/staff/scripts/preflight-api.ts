import { ReleaseDiagnosticError } from './release-diagnostics';
import { setTimeout as wait } from 'node:timers/promises';

const versionDelays = [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000];
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function array(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Invalid metadata');
  return value.map(object);
}
export class MetadataClient {
  constructor(
    private options: {
      accountId: string;
      token: string;
      fetch?: typeof fetch;
      wait?: (milliseconds: number) => Promise<void>;
    },
  ) {}
  private async request(path: string, sql?: string): Promise<Record<string, unknown>> {
    const resource = path.startsWith('/zones')
      ? path
      : `/accounts/${encodeURIComponent(this.options.accountId)}${path}`;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        `https://api.cloudflare.com/client/v4${resource}`,
        {
          method: sql ? 'POST' : 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
          headers: {
            Authorization: `Bearer ${this.options.token}`,
            'Content-Type': 'application/json',
          },
          body: sql ? JSON.stringify({ sql }) : undefined,
        },
      );
    } catch {
      throw new ReleaseDiagnosticError([{ id: 'provider.metadata', status: 'unverified' }]);
    }
    let data: Record<string, unknown>;
    try {
      data = object(await response.json());
    } catch {
      throw new ReleaseDiagnosticError([{ id: 'provider.metadata', status: 'unverified' }], {
        httpStatus: response.status,
      });
    }
    if (!response.ok || data.success !== true || !('result' in data))
      throw new ReleaseDiagnosticError([{ id: 'provider.metadata', status: 'unverified' }], {
        httpStatus: response.status,
        cloudflareCodes: Array.isArray(data.errors)
          ? data.errors.map((error) => object(error).code)
          : [],
      });
    return data;
  }
  async get(path: string, readiness?: { uploadedVersion: boolean }): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await this.request(path)).result;
      } catch (error) {
        const diagnostics = error instanceof ReleaseDiagnosticError ? error.diagnostics : null;
        const delay = versionDelays.at(attempt);
        if (
          !readiness?.uploadedVersion ||
          !/^\/workers\/scripts\/[^/]+\/versions\/[a-f0-9-]{36}$/.test(path) ||
          diagnostics?.httpStatus !== 404 ||
          diagnostics.cloudflareCodes?.length !== 1 ||
          diagnostics.cloudflareCodes[0] !== 100146 ||
          delay === undefined
        )
          throw error;
        await (this.options.wait ?? wait)(delay);
      }
    }
  }
  async zones(): Promise<Record<string, unknown>[]> {
    const zones = await this.list(
      `/zones?account.id=${encodeURIComponent(this.options.accountId)}`,
    );
    if (!zones.every((zone) => object(zone.account).id === this.options.accountId))
      throw new Error('Wrong zone account');
    return zones;
  }
  async zoneRoutes(zoneId: string): Promise<Record<string, unknown>[]> {
    return array(await this.get(`/zones/${encodeURIComponent(zoneId)}/workers/routes`));
  }
  async list(path: string): Promise<Record<string, unknown>[]> {
    const entries: Record<string, unknown>[] = [];
    for (let page = 1; page <= 100; page++) {
      const response = await this.request(
        `${path}${path.includes('?') ? '&' : '?'}page=${page}&per_page=50`,
      );
      const batch = array(response.result);
      entries.push(...batch);
      const pages = object(response.result_info).total_pages;
      if (typeof pages === 'number' && Number.isInteger(pages) && pages >= page) {
        if (page === pages) return entries;
      } else if (pages === undefined && batch.length < 50) return entries;
      else throw new Error('Incomplete metadata');
    }
    throw new Error('Metadata exceeds bounded inventory');
  }
  async migrations(databaseId: string): Promise<string[]> {
    const response = await this.request(
      `/d1/database/${encodeURIComponent(databaseId)}/query`,
      'SELECT name FROM d1_migrations ORDER BY id',
    );
    const result = array(response.result).at(0);
    if (result?.success !== true) throw new Error('Migration metadata unavailable');
    return array(result.results).map((row) => String(row.name));
  }
}
