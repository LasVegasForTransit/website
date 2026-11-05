export class ConnectorFailure extends Error {
  constructor(
    readonly kind: string,
    readonly retryAfterMs = 60000,
  ) {
    super(`Workspace connector failure: ${kind}`);
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConnectorFailure('invalid_response');
  return value as Record<string, unknown>;
}
export async function readJson(
  response: Response,
  limit = 131072,
): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new ConnectorFailure('invalid_response');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '',
    size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new ConnectorFailure('body_too_large');
      text += decoder.decode(part.value, { stream: true });
    }
    return record(JSON.parse(text + decoder.decode()));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function request(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetcher(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.any([AbortSignal.timeout(5000), ...(init.signal ? [init.signal] : [])]),
    });
  } catch {
    throw new ConnectorFailure('provider_unavailable');
  }
}
export async function jsonRequest(fetcher: typeof fetch, url: string, init: RequestInit = {}) {
  const response = await request(fetcher, url, init);
  if (!response.ok) throw new ConnectorFailure('provider_unavailable');
  return readJson(response);
}
export function retryAfter(response: Response, now: Date) {
  const raw = response.headers.get('Retry-After') ?? '60';
  const delay = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now.getTime();
  return Number.isFinite(delay) && delay > 0 ? Math.min(Math.ceil(delay), 86400000) : 60000;
}
