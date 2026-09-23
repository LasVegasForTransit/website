// Signed, single-purpose tokens for links and short-lived browser state. A
// token is `<payload>.<signature>`, both base64url. The payload names its
// purpose and an expiry, so a token made for one job (say, removing an email)
// can never be replayed for another. Uses Web Crypto, which both Cloudflare's
// runtime and Node provide.

export interface TokenPayload {
  /** What the token is for, for example "remove_email". */
  purpose: string;
  /** The person or record it refers to. */
  subject: string;
  /** Expiry, in milliseconds since 1970. */
  expiresAt: number;
  /** Optional extra data the purpose needs. */
  data?: Record<string, string>;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signToken(secret: string, payload: TokenPayload): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

function isPayload(value: unknown): value is TokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.purpose === 'string' &&
    typeof record.subject === 'string' &&
    typeof record.expiresAt === 'number'
  );
}

/** The payload, or null when the token is forged, expired or for another purpose. */
export async function verifyToken(
  secret: string,
  token: string,
  purpose: string,
  now: number = Date.now(),
): Promise<TokenPayload | null> {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(signature),
      encoder.encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return null;
  }
  if (!isPayload(parsed) || parsed.purpose !== purpose || parsed.expiresAt < now) return null;
  return parsed;
}

/** A one-way hash, for storing things like IP addresses without keeping them. */
export async function hashWithSecret(secret: string, value: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}
