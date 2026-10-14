const MAX_SUBSCRIPTIONS_RESPONSE_BYTES = 1_048_576;

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export async function beehiivJsonBody(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  if (isAborted(signal)) {
    void reader.cancel().catch(() => undefined);
    return null;
  }
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
      if (isAborted(signal)) return null;
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

export function beehiivRetryAfter(response: Response, now: number): number | null {
  const raw = response.headers.get('Retry-After');
  if (!raw) return null;
  const delay = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  return Number.isFinite(delay) && delay > 0 ? Math.ceil(Math.min(delay, 86_400_000)) : null;
}
