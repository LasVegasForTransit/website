import {
  DiscordApiFailure,
  object,
  type DiscordOptions,
  type DiscordRateLimit,
} from './discord-types';
const ENDPOINT = 'https://discord.com/api/v10';
interface RequestInput {
  method?: 'GET' | 'PUT' | 'DELETE' | 'POST';
  authorization: string;
  reason?: string;
  body?: URLSearchParams;
  unknownMember?: boolean;
}
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new DiscordApiFailure('invalid_response');
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
      if (part.done) break;
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array)) throw new DiscordApiFailure('invalid_response');
      size += chunk.byteLength;
      if (size > 131072) throw new DiscordApiFailure('invalid_response');
      text += decoder.decode(chunk, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch {
    void reader.cancel().catch(() => undefined);
    throw new DiscordApiFailure('invalid_response');
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
function retryTiming(response: Response, data: Record<string, unknown>): number {
  const header = Number(response.headers.get('Retry-After'));
  const body = typeof data.retry_after === 'number' ? data.retry_after : 0;
  const valid = [header, body].filter(
    (seconds) => Number.isFinite(seconds) && seconds > 0 && seconds <= 86400,
  );
  return valid.length ? Math.ceil(Math.max(...valid) * 1000) : 60_000;
}
export class DiscordHttp {
  private blockedUntil = 0;
  private blockedGlobally = false;
  private readonly fetcher: typeof fetch;
  readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly rateLimit: DiscordRateLimit | undefined;
  constructor(options: DiscordOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
    this.rateLimit = options.rateLimit;
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 10_000)
      throw new DiscordApiFailure('not_configured');
  }
  async request(path: string, input: RequestInput): Promise<unknown> {
    const shared = await this.rateLimit?.current();
    if (shared) throw new DiscordApiFailure('rate_limited', shared.retryAfterMs, shared.global);
    const remaining = this.blockedUntil - this.now();
    if (remaining > 0) throw new DiscordApiFailure('rate_limited', remaining, this.blockedGlobally);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.perform(path, input, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new DiscordApiFailure('provider_unavailable'));
          }, this.timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error instanceof DiscordApiFailure) throw error;
      throw new DiscordApiFailure('provider_unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
  private async perform(path: string, input: RequestInput, signal: AbortSignal): Promise<unknown> {
    const headers = new Headers({ Authorization: input.authorization, Accept: 'application/json' });
    if (input.reason) headers.set('X-Audit-Log-Reason', encodeURIComponent(input.reason));
    if (input.body) headers.set('Content-Type', 'application/x-www-form-urlencoded');
    const response = await this.fetcher(`${ENDPOINT}${path}`, {
      method: input.method ?? 'GET',
      headers,
      redirect: 'manual',
      signal,
      ...(input.body ? { body: input.body } : {}),
    });
    if (signal.aborted) throw new DiscordApiFailure('provider_unavailable');
    if (response.status >= 300 && response.status < 400)
      throw new DiscordApiFailure('invalid_response');
    return await this.result(response, input, signal);
  }
  private async limited(response: Response, signal: AbortSignal): Promise<never> {
    const fallback: Record<string, unknown> = {};
    const details = await json(response, signal)
      .then(object)
      .catch(() => fallback);
    const retry = retryTiming(response, details);
    this.blockedUntil = this.now() + retry;
    this.blockedGlobally =
      details.global === true || response.headers.get('X-RateLimit-Global') === 'true';
    await this.rateLimit?.defer({ retryAfterMs: retry, global: this.blockedGlobally });
    throw new DiscordApiFailure('rate_limited', retry, this.blockedGlobally);
  }
  private async result(
    response: Response,
    input: RequestInput,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (response.status === 204 && ['PUT', 'DELETE'].includes(input.method ?? 'GET')) return null;
    if (response.status === 401 || response.status === 403)
      throw new DiscordApiFailure('permission_denied');
    if (response.status >= 500) throw new DiscordApiFailure('provider_unavailable');
    if (response.status === 429) return await this.limited(response, signal);
    const data = await json(response, signal);
    if (response.status === 404 && input.unknownMember && object(data).code === 10007) return null;
    if (response.status !== 200) throw new DiscordApiFailure('unknown');
    if (input.method === 'PUT' || input.method === 'DELETE')
      throw new DiscordApiFailure('invalid_response');
    return data;
  }
}
