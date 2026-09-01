// Request/response helpers shared by the Pages Functions under functions/api.
// Underscore-prefixed so Cloudflare Pages does not treat it as a route.

export const jsonHeaders = { 'Content-Type': 'application/json' };

export function errorResponse<E extends string>(
  error: E,
  status: number,
  details?: Record<string, unknown>,
): Response {
  return Response.json(details ? { error, ...details } : { error }, {
    status,
    headers: jsonHeaders,
  });
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? '';
}

// Compare without an early-exit per character so a wrong token can't be
// probed byte-by-byte via response timing.
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}
