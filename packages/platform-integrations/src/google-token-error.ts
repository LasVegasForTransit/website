const REASONS = [
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'invalid_request',
  'unsupported_grant_type',
] as const;
type RejectionReason = (typeof REASONS)[number] | 'rejected';

export class GoogleTokenExchangeError extends Error {
  constructor(
    readonly status: number,
    readonly reason: RejectionReason,
  ) {
    super('Google sign-in exchange failed');
  }
}

/** Keep only a recognized error code; never retain Google's error description. */
export async function googleTokenRejection(response: Response): Promise<GoogleTokenExchangeError> {
  const reader = response.body?.getReader();
  if (!reader) return new GoogleTokenExchangeError(response.status, 'rejected');
  const timeout = setTimeout(() => {
    void reader.cancel().catch(() => undefined);
  }, 1000);
  let length = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array))
        return new GoogleTokenExchangeError(response.status, 'rejected');
      length += chunk.byteLength;
      if (length > 4096) {
        await reader.cancel();
        return new GoogleTokenExchangeError(response.status, 'rejected');
      }
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
    const body: unknown = JSON.parse(text);
    const reason =
      typeof body === 'object' && body !== null && 'error' in body
        ? (REASONS.find((value) => value === body.error) ?? 'rejected')
        : 'rejected';
    return new GoogleTokenExchangeError(response.status, reason);
  } catch {
    return new GoogleTokenExchangeError(response.status, 'rejected');
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}
