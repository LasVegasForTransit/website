import {
  GoogleGroupsFailure,
  record,
  type GoogleGroupsOptions,
  type GoogleTokenSource,
} from './google-groups-types';

const ENDPOINT = 'https://admin.googleapis.com/admin/directory/v1';
const SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.member',
]);
interface Request {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: { email: string; role: 'MEMBER' };
  missingMember?: boolean;
}
function active(signal: AbortSignal): void {
  if (signal.aborted) throw new GoogleGroupsFailure('provider_unavailable');
}
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new GoogleGroupsFailure('invalid_response');
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
      if (signal.aborted) throw new GoogleGroupsFailure('provider_unavailable');
      if (part.done) break;
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array)) throw new GoogleGroupsFailure('invalid_response');
      size += chunk.byteLength;
      if (size > 131072) throw new GoogleGroupsFailure('invalid_response');
      text += decoder.decode(chunk, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch {
    void reader.cancel().catch(() => undefined);
    throw new GoogleGroupsFailure('invalid_response');
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
function reasons(data: unknown, status: number): string[] {
  try {
    const error = record(record(data).error);
    if (error.code !== status || !Array.isArray(error.errors)) return [];
    return error.errors.flatMap((entry: unknown) => {
      const reason = record(entry).reason;
      return typeof reason === 'string' ? [reason] : [];
    });
  } catch {
    return [];
  }
}
function retry(response: Response, now: number): number {
  const raw = response.headers.get('Retry-After');
  if (raw === null) return 60_000;
  const value = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  return Number.isFinite(value) && value > 0 ? Math.ceil(Math.min(value, 86400000)) : 60_000;
}
export class GoogleGroupsHttp {
  private readonly fetcher: typeof fetch;
  readonly now: () => number;
  private readonly timeoutMs: number;
  private blockedUntil = 0;
  constructor(
    private readonly tokens: GoogleTokenSource,
    private readonly options: GoogleGroupsOptions,
  ) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 10000)
      throw new GoogleGroupsFailure('not_configured');
  }
  async request(path: string, input: Request, deadline: number): Promise<unknown> {
    const timeout = Math.min(this.timeoutMs, deadline - this.now());
    if (timeout <= 0) throw new GoogleGroupsFailure('provider_unavailable');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.perform(path, input, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new GoogleGroupsFailure('provider_unavailable'));
          }, timeout);
        }),
      ]);
    } catch (error) {
      if (error instanceof GoogleGroupsFailure) throw error;
      throw new GoogleGroupsFailure('provider_unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
  private async perform(path: string, input: Request, signal: AbortSignal): Promise<unknown> {
    const shared = await this.options.rateLimit?.current();
    const remaining = Math.max(shared ?? 0, this.blockedUntil - this.now());
    if (remaining > 0) throw new GoogleGroupsFailure('rate_limited', remaining);
    const token: unknown = await this.tokens.getToken(SCOPES);
    active(signal);
    if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token))
      throw new GoogleGroupsFailure('not_configured');
    const headers = new Headers({ Authorization: `Bearer ${token}`, Accept: 'application/json' });
    if (input.body) headers.set('Content-Type', 'application/json');
    const response = await this.fetcher(`${ENDPOINT}${path}`, {
      method: input.method ?? 'GET',
      headers,
      redirect: 'manual',
      signal,
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    });
    active(signal);
    return await this.result(response, input, signal);
  }
  private async result(response: Response, input: Request, signal: AbortSignal): Promise<unknown> {
    if (response.status >= 300 && response.status < 400)
      throw new GoogleGroupsFailure('invalid_response');
    if (input.method === 'DELETE' && (response.status === 200 || response.status === 204))
      return null;
    if (response.status >= 500) throw new GoogleGroupsFailure('provider_unavailable');
    const data = await json(response, signal).catch((error: unknown) => {
      if ([401, 403, 404, 409, 429].includes(response.status)) return null;
      throw error;
    });
    if (response.status === 200) return data;
    return await this.failure(response, input, data);
  }
  private async failure(response: Response, input: Request, data: unknown): Promise<null> {
    const codes = reasons(data, response.status);
    if (
      response.status === 429 ||
      (response.status === 403 &&
        codes.some((code) =>
          ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(code),
        ))
    ) {
      const delay = retry(response, this.now());
      this.blockedUntil = this.now() + delay;
      await this.options.rateLimit?.defer(delay);
      throw new GoogleGroupsFailure('rate_limited', delay);
    }
    if (response.status === 401 || response.status === 403)
      throw new GoogleGroupsFailure('permission_denied');
    if (response.status === 404 && input.missingMember && codes.includes('notFound')) return null;
    if (response.status === 409 && input.method === 'POST') return null;
    throw new GoogleGroupsFailure('unknown');
  }
}
