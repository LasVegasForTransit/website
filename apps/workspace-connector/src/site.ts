import type { ManagedGoogleCredentials } from './credentials';
import { ConnectorFailure, jsonRequest } from './http';
export class Site {
  constructor(
    private readonly audience: string,
    private readonly credentials: ManagedGoogleCredentials,
    private readonly fetcher: typeof fetch,
  ) {}
  async action(action: string, input: object = {}): Promise<Record<string, unknown>> {
    return jsonRequest(this.fetcher, this.audience, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.credentials.idToken(this.audience)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...input }),
    });
  }
  async current(token: string) {
    return (await this.action('current', { token })).current === true;
  }
  async accepted(action: string, input: object) {
    try {
      return (await this.action(action, input)).current === true;
    } catch {
      throw new ConnectorFailure('stale_operation');
    }
  }
}
