import type { DirectoryAccount } from '@lasvegasfortransit/platform-core/workspace-onboarding';
import { directoryAccount } from '@lasvegasfortransit/platform-core/workspace-onboarding';
import type { ConnectorConfig } from './config';
import type { ManagedGoogleCredentials } from './credentials';
import { ConnectorFailure, readJson, record, request, retryAfter } from './http';
import type { Site } from './site';
const ENDPOINT = 'https://admin.googleapis.com/admin/directory/v1';
function text(value: unknown) {
  return typeof value === 'string' ? value : null;
}
const SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
];
export class Directory {
  private orgUnits: Map<string, string> | null = null;
  constructor(
    private readonly config: ConnectorConfig,
    private readonly credentials: ManagedGoogleCredentials,
    private readonly context: { fetch: typeof fetch; now: () => Date; site: Site },
  ) {}
  async call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('#'))
      throw new ConnectorFailure('not_configured');
    const token = await this.credentials.getToken(SCOPES);
    const response = await request(this.context.fetch, `${ENDPOINT}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (response.status === 429) await this.pause(response);
    const value = await readJson(response);
    if (
      response.status === 403 &&
      /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.exec(JSON.stringify(value))
    ) {
      await this.pause(response);
    }
    if (expiredPageToken(path, response.status, value))
      throw new ConnectorFailure('expired_page_token');
    if (!response.ok)
      throw new ConnectorFailure(response.status === 404 ? 'not_found' : 'provider_unavailable');
    return value;
  }
  private async pause(response: Response): Promise<never> {
    const delay = retryAfter(response, this.context.now());
    await this.context.site.action('backoff', { retryAfterMs: delay });
    throw new ConnectorFailure('rate_limited', delay);
  }
  async account(userId: string) {
    if (!/^[\w-]{1,128}$/.test(userId)) throw new ConnectorFailure('invalid_notification');
    const observedAt = this.context.now().toISOString();
    const user = await this.call(
      `/users/${encodeURIComponent(userId)}?projection=basic&viewType=admin_view`,
    );
    if (user.id !== userId) throw new ConnectorFailure('identity_changed');
    return this.observation(user, false, observedAt);
  }
  async observation(
    user: Record<string, unknown>,
    deleted: boolean,
    observedAt: string,
  ): Promise<DirectoryAccount> {
    if (!this.orgUnits && !deleted) await this.loadOrgUnits();
    const name = user.name ? record(user.name) : {};
    const account = {
      customerId: user.customerId ?? (deleted ? this.config.customerId : undefined),
      userId: user.id,
      email: typeof user.primaryEmail === 'string' ? user.primaryEmail.toLowerCase() : null,
      givenName: text(name.givenName),
      familyName: text(name.familyName),
      orgUnitId: this.unit(user.orgUnitPath),
      suspended: deleted || user.suspended === true,
      archived: user.archived === true,
      deleted,
      observedAt,
    };
    if (!deleted && typeof user.suspended !== 'boolean')
      throw new ConnectorFailure('invalid_response');
    const validated = directoryAccount(account, this.context.now());
    if (validated?.customerId !== this.config.customerId)
      throw new ConnectorFailure('identity_changed');
    return validated;
  }
  private unit(path: unknown) {
    return typeof path === 'string' ? (this.orgUnits?.get(path) ?? null) : null;
  }
  private async loadOrgUnits() {
    const data = await this.call(
      `/customer/${encodeURIComponent(this.config.customerId)}/orgunits?type=all_including_parent`,
    );
    if (!Array.isArray(data.organizationUnits)) throw new ConnectorFailure('invalid_response');
    this.orgUnits = new Map();
    for (const raw of data.organizationUnits) {
      const ou = record(raw);
      if (typeof ou.orgUnitId !== 'string' || typeof ou.orgUnitPath !== 'string')
        throw new ConnectorFailure('invalid_response');
      this.orgUnits.set(ou.orgUnitPath, ou.orgUnitId);
      if (typeof ou.parentOrgUnitId === 'string' && ou.parentOrgUnitPath === '/')
        this.orgUnits.set('/', ou.parentOrgUnitId);
    }
  }
  async page(phase: 'active' | 'deleted', pageToken: string | null) {
    const query = new URLSearchParams({
      customer: this.config.customerId,
      maxResults: '50',
      projection: 'basic',
      viewType: 'admin_view',
      showDeleted: phase === 'deleted' ? 'true' : 'false',
    });
    if (pageToken) query.set('pageToken', pageToken);
    const observedAt = this.context.now().toISOString();
    const data = await this.call(`/users?${query}`);
    if (
      (data.users !== undefined && !Array.isArray(data.users)) ||
      (data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string')
    )
      throw new ConnectorFailure('invalid_response');
    return {
      observedAt,
      users: (data.users ?? []) as unknown[],
      nextPageToken: typeof data.nextPageToken === 'string' ? data.nextPageToken : null,
    };
  }
}

function expiredPageToken(path: string, status: number, data: Record<string, unknown>) {
  if (
    ![400, 410].includes(status) ||
    !path.startsWith('/users?') ||
    !new URLSearchParams(path.slice(7)).has('pageToken')
  )
    return false;
  const error = data.error;
  if (!error || typeof error !== 'object') return false;
  const details = error as { message?: unknown; errors?: unknown };
  if (typeof details.message === 'string' && /page.?token|pagination.?token/i.test(details.message))
    return true;
  if (!Array.isArray(details.errors)) return false;
  return details.errors.some((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as { reason?: unknown; location?: unknown };
    return (
      e.location === 'pageToken' ||
      e.reason === 'invalidPageToken' ||
      e.reason === 'pageTokenExpired'
    );
  });
}
