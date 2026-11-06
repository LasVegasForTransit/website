import { ConnectorFailure, jsonRequest, request } from './http';
const METADATA =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default';
const TOKEN = 'https://oauth2.googleapis.com/token';
const ALLOWED = new Set(
  ['user.readonly', 'orgunit.readonly', 'group.readonly', 'group.member'].map(
    (s) => `https://www.googleapis.com/auth/admin.directory.${s}`,
  ),
);
interface Options {
  fetch?: typeof fetch;
  now?: () => Date;
}
interface Config {
  serviceAccount: string;
  siteAudience: string;
}
export class ManagedGoogleCredentials {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly cache = new Map<string, { token: string; until: number }>();
  constructor(
    private readonly config: Config,
    options: Options = {},
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    if (!/^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(config.serviceAccount))
      throw new ConnectorFailure('not_configured');
  }
  async getToken(scopes: readonly string[]): Promise<string> {
    if (!scopes.length || scopes.some((scope) => !ALLOWED.has(scope)))
      throw new ConnectorFailure('not_configured');
    const scope = [...new Set(scopes)].sort().join(' '),
      cached = this.cache.get(scope),
      now = this.now().getTime();
    if (cached && cached.until > now + 60000) return cached.token;
    const runtime = await jsonRequest(this.fetcher, `${METADATA}/token`, {
      headers: { 'Metadata-Flavor': 'Google' },
    });
    const runtimeToken = this.token(runtime);
    const payload = {
      iss: this.config.serviceAccount,
      aud: TOKEN,
      scope,
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 3600,
    };
    const signed = await jsonRequest(
      this.fetcher,
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${this.config.serviceAccount}:signJwt`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${runtimeToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: JSON.stringify(payload) }),
      },
    );
    if (typeof signed.signedJwt !== 'string' || signed.signedJwt.length > 16384)
      throw new ConnectorFailure('invalid_response');
    const workspaceTokenResponse = await jsonRequest(this.fetcher, TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signed.signedJwt,
      }).toString(),
    });
    const token = this.token(workspaceTokenResponse),
      until = now + Number(workspaceTokenResponse.expires_in) * 1000;
    this.cache.set(scope, { token, until });
    return token;
  }
  private token(value: Record<string, unknown>): string {
    if (
      typeof value.access_token !== 'string' ||
      !/^[\x21-\x7e]{1,4096}$/.test(value.access_token) ||
      typeof value.expires_in !== 'number' ||
      value.expires_in <= 60 ||
      value.expires_in > 3600
    )
      throw new ConnectorFailure('invalid_response');
    return value.access_token;
  }
  async idToken(audience: string): Promise<string> {
    if (audience !== this.config.siteAudience) throw new ConnectorFailure('not_configured');
    const response = await request(
      this.fetcher,
      `${METADATA}/identity?audience=${encodeURIComponent(audience)}&format=full`,
      { headers: { 'Metadata-Flavor': 'Google' } },
    );
    if (!response.ok) throw new ConnectorFailure('provider_unavailable');
    const token = await response.text();
    if (!/^[\x21-\x7e]{1,16384}$/.test(token)) throw new ConnectorFailure('invalid_response');
    return token;
  }
}
