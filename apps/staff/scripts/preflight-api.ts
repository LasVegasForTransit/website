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
  constructor(private options: { accountId: string; token: string; fetch?: typeof fetch }) {}
  private async request(path: string, sql?: string): Promise<Record<string, unknown>> {
    const resource = path.startsWith('/zones')
      ? path
      : `/accounts/${encodeURIComponent(this.options.accountId)}${path}`;
    const response = await (this.options.fetch ?? fetch)(
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
    if (!response.ok) throw new Error('Metadata unavailable');
    const data = object(await response.json());
    if (data.success !== true || !('result' in data)) throw new Error('Metadata unavailable');
    return data;
  }
  async get(path: string): Promise<unknown> {
    return (await this.request(path)).result;
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
