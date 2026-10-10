// Beehiiv holds LVBT's mailing list. Subscribing someone here is what makes
// them a member today, so the platform subscribes every new member.

export interface BeehiivConfig {
  apiKey: string;
  publicationId: string;
}

export interface BeehiivSubscription {
  id: string;
  email: string;
  status: string;
  created: number;
}

export interface BeehiivListOptions {
  cursor?: string;
  limit?: number;
  now?: () => number;
}

export type BeehiivSubscriptionPageResult =
  | {
      ok: true;
      subscriptions: BeehiivSubscription[];
      hasMore: boolean;
      nextCursor: string | null;
    }
  | {
      ok: false;
      kind: 'provider_error' | 'invalid_response' | 'transport';
      status: number | null;
      retryAfterMs: number | null;
    };

export type BeehiivSubscriptionsResult =
  | { ok: true; subscriptions: BeehiivSubscription[]; pagesRead: number }
  | {
      ok: false;
      kind: 'provider_error' | 'invalid_response' | 'transport';
      status: number | null;
      retryAfterMs: number | null;
      pagesRead: number;
    };

const MAX_SUBSCRIPTIONS_RESPONSE_BYTES = 1_048_576;
const MAX_SUBSCRIPTION_PAGES = 25;
const SUBSCRIPTION_PAGE_SIZE = 100;

async function jsonBody(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (signal.aborted) return null;
      if (part.done) break;
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array)) return null;
      size += chunk.byteLength;
      if (size > MAX_SUBSCRIPTIONS_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(chunk, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch {
    void reader.cancel().catch(() => undefined);
    return null;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function parseRetryAfter(response: Response, now: number): number | null {
  const raw = response.headers.get('Retry-After');
  if (!raw) return null;
  const delay = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  return Number.isFinite(delay) && delay > 0 ? Math.ceil(Math.min(delay, 86_400_000)) : null;
}

function subscription(value: unknown): BeehiivSubscription | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' &&
    /^sub_[A-Za-z0-9_-]{1,124}$/.test(row.id) &&
    typeof row.email === 'string' &&
    row.email.length > 0 &&
    row.email.length <= 254 &&
    typeof row.status === 'string' &&
    row.status.length > 0 &&
    row.status.length <= 64 &&
    typeof row.created === 'number' &&
    Number.isSafeInteger(row.created) &&
    row.created >= 0
    ? { id: row.id, email: row.email, status: row.status, created: row.created }
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidSubscriptionResponse(status: number): BeehiivSubscriptionPageResult {
  return { ok: false, kind: 'invalid_response', status, retryAfterMs: null };
}

interface ParsedSubscriptionPage {
  subscriptions: BeehiivSubscription[];
  hasMore: boolean;
  nextCursor: string | null;
}

function parseSubscriptionPage(
  body: unknown,
  cursor: string | undefined,
  limit: number,
): ParsedSubscriptionPage | null {
  if (!isRecord(body)) return null;
  const { data, has_more: hasMore } = body;
  if (!Array.isArray(data) || data.length > limit || typeof hasMore !== 'boolean') return null;

  const subscriptions: BeehiivSubscription[] = [];
  for (const item of data) {
    const parsed = subscription(item);
    if (!parsed) return null;
    subscriptions.push(parsed);
  }

  let nextCursor: string | null = null;
  if (hasMore) {
    const candidate = body.next_cursor;
    if (
      typeof candidate !== 'string' ||
      candidate.length === 0 ||
      candidate.length > 4096 ||
      candidate === cursor
    )
      return null;
    nextCursor = candidate;
  }

  return { subscriptions, hasMore, nextCursor };
}

function listLimit(options: BeehiivListOptions): number {
  const limit = options.limit ?? 100;
  const cursor = options.cursor;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (cursor !== undefined && (cursor.length === 0 || cursor.length > 4096))
  ) {
    throw new Error('Invalid Beehiiv list options');
  }
  return limit;
}

async function requestSubscriptions(
  url: URL,
  apiKey: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<Response | null> {
  try {
    return await fetcher(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
  } catch {
    return null;
  }
}

async function providerError(
  response: Response,
  now: () => number,
): Promise<BeehiivSubscriptionPageResult> {
  const retryAfterMs = parseRetryAfter(response, now());
  await response.body?.cancel().catch(() => undefined);
  return {
    ok: false,
    kind: 'provider_error',
    status: response.status,
    retryAfterMs: response.status === 429 ? (retryAfterMs ?? 60_000) : retryAfterMs,
  };
}

export async function listSubscriptions(
  config: BeehiivConfig,
  options: BeehiivListOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<BeehiivSubscriptionPageResult> {
  const limit = listLimit(options);
  const cursor = options.cursor;
  const url = new URL(
    `https://api.beehiiv.com/v2/publications/${encodeURIComponent(config.publicationId)}/subscriptions`,
  );
  url.searchParams.set('limit', String(limit));
  if (cursor !== undefined) url.searchParams.set('cursor', cursor);

  const signal = AbortSignal.timeout(8000);
  const response = await requestSubscriptions(url, config.apiKey, signal, fetcher);
  if (!response) {
    return { ok: false, kind: 'transport', status: null, retryAfterMs: null };
  }

  if (!response.ok) return providerError(response, options.now ?? Date.now);

  const body = await jsonBody(response, signal);
  const page = parseSubscriptionPage(body, cursor, limit);
  if (!page) return invalidSubscriptionResponse(response.status);
  return {
    ok: true,
    ...page,
  };
}

/** Read the full bounded Beehiiv roster, returning no partial list on failure. */
export async function listAllSubscriptions(
  config: BeehiivConfig,
  options: Pick<BeehiivListOptions, 'now'> = {},
  fetcher: typeof fetch = fetch,
): Promise<BeehiivSubscriptionsResult> {
  const subscriptions: BeehiivSubscription[] = [];
  const requestedCursors = new Set<string>();
  let cursor: string | undefined;
  let pagesRead = 0;

  while (pagesRead < MAX_SUBSCRIPTION_PAGES) {
    if (cursor !== undefined) {
      if (requestedCursors.has(cursor))
        return { ok: false, kind: 'invalid_response', status: 200, retryAfterMs: null, pagesRead };
      requestedCursors.add(cursor);
    }

    const page = await listSubscriptions(
      config,
      {
        ...(cursor === undefined ? {} : { cursor }),
        limit: SUBSCRIPTION_PAGE_SIZE,
        ...(options.now ? { now: options.now } : {}),
      },
      fetcher,
    );
    pagesRead += 1;
    if (!page.ok) return { ...page, pagesRead };

    subscriptions.push(...page.subscriptions);
    if (!page.hasMore) return { ok: true, subscriptions, pagesRead };
    cursor = page.nextCursor ?? undefined;
  }

  return {
    ok: false,
    kind: 'invalid_response',
    status: 200,
    retryAfterMs: null,
    pagesRead,
  };
}

export type SubscribeResult = { ok: true; subscriptionId: string | null } | { ok: false };

export async function subscribe(
  config: BeehiivConfig,
  email: string,
  options: { sendWelcomeEmail: boolean; utmSource: string },
  fetcher: typeof fetch = fetch,
): Promise<SubscribeResult> {
  let response: Response;
  try {
    response = await fetcher(
      `https://api.beehiiv.com/v2/publications/${config.publicationId}/subscriptions`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          reactivate_existing: true,
          send_welcome_email: options.sendWelcomeEmail,
          // Consent is the ticked box on LVBT's own form, recorded in the
          // person record with its wording, so Beehiiv's own confirmation
          // step would only strand members as pending.
          double_opt_override: 'off',
          utm_source: options.utmSource,
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch {
    console.error('Beehiiv subscribe request failed');
    return { ok: false };
  }
  if (!response.ok) {
    console.error(
      'Beehiiv subscribe failed',
      response.status,
      await response.text().catch(() => ''),
    );
    return { ok: false };
  }
  const body: unknown = await response.json().catch(() => null);
  const data =
    typeof body === 'object' && body !== null
      ? (body as { data?: { id?: unknown } }).data
      : undefined;
  return { ok: true, subscriptionId: typeof data?.id === 'string' ? data.id : null };
}

export async function unsubscribe(
  config: BeehiivConfig,
  subscriptionId: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(
      `https://api.beehiiv.com/v2/publications/${config.publicationId}/subscriptions/${subscriptionId}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unsubscribe: true }),
        signal: AbortSignal.timeout(8000),
      },
    );
    await response.body?.cancel();
    return response.ok;
  } catch {
    console.error('Beehiiv unsubscribe request failed');
    return false;
  }
}
