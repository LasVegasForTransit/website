import type { BeehiivConfig, BeehiivSubscription } from './beehiiv';
import { beehiivJsonBody, beehiivRetryAfter } from './beehiiv-transport';

export interface BeehiivSubscriptionFailure {
  ok: false;
  kind: 'provider_error' | 'invalid_response' | 'transport' | 'not_confirmed';
  status: number | null;
  retryAfterMs: number | null;
}
export type BeehiivSubscriptionResult =
  { ok: true; subscription: BeehiivSubscription | null } | BeehiivSubscriptionFailure;

const STATUSES = new Set([
  'active',
  'inactive',
  'pending',
  'validating',
  'invalid',
  'needs_attention',
  'paused',
]);
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_-]{1,124}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validEmail(email: string): boolean {
  return email.length <= 254 && EMAIL.test(email);
}

function validCreationTime(value: unknown, now: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= Math.floor(now / 1000)
  );
}

function parseSubscription(body: unknown, now: number): BeehiivSubscription | null {
  if (typeof body !== 'object' || body === null || !('data' in body)) return null;
  const value: unknown = body.data;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' &&
    SUBSCRIPTION_ID.test(row.id) &&
    typeof row.email === 'string' &&
    validEmail(row.email) &&
    typeof row.status === 'string' &&
    STATUSES.has(row.status) &&
    validCreationTime(row.created, now)
    ? { id: row.id, email: row.email, status: row.status, created: row.created }
    : null;
}

/** Provider observations contain no inferred consent-change timestamps. */
export class BeehiivSubscriptions {
  private readonly configuration: BeehiivConfig;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(
    configuration: BeehiivConfig,
    options: { fetcher?: typeof fetch; now?: () => number } = {},
  ) {
    if (
      !/^pub_[A-Za-z0-9_-]{1,124}$/.test(configuration.publicationId) ||
      !configuration.apiKey.trim()
    )
      throw new Error('Invalid Beehiiv subscription configuration');
    this.configuration = { ...configuration };
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  private async request(
    path: string,
    method = 'GET',
    body?: Record<string, unknown>,
  ): Promise<{ ok: true; response: Response; signal: AbortSignal } | BeehiivSubscriptionFailure> {
    const signal = AbortSignal.timeout(8000);
    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.beehiiv.com/v2/publications/${this.configuration.publicationId}/subscriptions${path}`,
        {
          method,
          redirect: 'manual',
          signal,
          headers: {
            Authorization: `Bearer ${this.configuration.apiKey}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
    } catch {
      return { ok: false, kind: 'transport', status: null, retryAfterMs: null };
    }
    if (response.ok || (method === 'GET' && response.status === 404))
      return { ok: true, response, signal };
    const retryAfterMs = beehiivRetryAfter(response, this.now());
    await response.body?.cancel().catch(() => undefined);
    return {
      ok: false,
      kind: 'provider_error',
      status: response.status,
      retryAfterMs: response.status === 429 ? (retryAfterMs ?? 60_000) : retryAfterMs,
    };
  }

  private async read(
    path: string,
    expected: { id?: string; email?: string },
  ): Promise<BeehiivSubscriptionResult> {
    const result = await this.request(path);
    if (!result.ok) return result;
    if (result.response.status === 404) {
      await result.response.body?.cancel().catch(() => undefined);
      return { ok: true, subscription: null };
    }
    const body = await beehiivJsonBody(result.response, result.signal);
    const subscription = parseSubscription(body, this.now());
    if (
      !subscription ||
      (expected.id && subscription.id !== expected.id) ||
      (expected.email && subscription.email.toLowerCase() !== expected.email.toLowerCase())
    )
      return {
        ok: false,
        kind: result.signal.aborted ? 'transport' : 'invalid_response',
        status: result.response.status,
        retryAfterMs: null,
      };
    return { ok: true, subscription };
  }

  async getById(id: string): Promise<BeehiivSubscriptionResult> {
    if (!SUBSCRIPTION_ID.test(id)) throw new Error('Invalid Beehiiv subscription ID');
    return await this.read(`/${id}`, { id });
  }

  async getByEmail(email: string): Promise<BeehiivSubscriptionResult> {
    if (!validEmail(email)) throw new Error('Invalid Beehiiv subscription email');
    return await this.read(`/by_email/${encodeURIComponent(email)}`, { email });
  }

  /** Call only for current, recorded newsletter consent; always verify a separate read. */
  async activate(email: string): Promise<BeehiivSubscriptionResult> {
    if (!validEmail(email)) throw new Error('Invalid Beehiiv subscription email');
    const result = await this.request('', 'POST', {
      email,
      reactivate_existing: true,
      send_welcome_email: false,
      double_opt_override: 'off',
      utm_source: 'membership_sync',
    });
    if (!result.ok) return result;
    await result.response.body?.cancel().catch(() => undefined);
    const observed = await this.getByEmail(email);
    return !observed.ok || observed.subscription?.status === 'active'
      ? observed
      : { ok: false, kind: 'not_confirmed', status: 200, retryAfterMs: 60_000 };
  }

  async deactivate(id: string): Promise<BeehiivSubscriptionResult> {
    if (!SUBSCRIPTION_ID.test(id)) throw new Error('Invalid Beehiiv subscription ID');
    const result = await this.request(`/${id}`, 'PATCH', { unsubscribe: true });
    if (!result.ok) return result;
    await result.response.body?.cancel().catch(() => undefined);
    const observed = await this.getById(id);
    return !observed.ok ||
      observed.subscription === null ||
      observed.subscription.status === 'inactive'
      ? observed
      : { ok: false, kind: 'not_confirmed', status: 200, retryAfterMs: 60_000 };
  }

  /** Permanently remove only an authorized erased account, then verify its absence. */
  async remove(id: string): Promise<BeehiivSubscriptionResult> {
    if (!SUBSCRIPTION_ID.test(id)) throw new Error('Invalid Beehiiv subscription ID');
    const result = await this.request(`/${id}`, 'DELETE');
    if (!result.ok && result.status !== 404) return result;
    if (result.ok) await result.response.body?.cancel().catch(() => undefined);
    const observed = await this.getById(id);
    return !observed.ok || observed.subscription === null
      ? observed
      : { ok: false, kind: 'not_confirmed', status: 200, retryAfterMs: 60_000 };
  }
}
