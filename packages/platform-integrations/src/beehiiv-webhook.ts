export interface BeehiivEvent {
  publicationId: string;
  id: string;
  type: 'subscription.created' | 'subscription.confirmed' | 'subscription.deleted';
  occurredAt: string;
  subscriptionId: string;
  email: string;
}
interface WebhookInput {
  body: Uint8Array;
  headers: Headers;
  secret: string;
  publicationId: string;
  now: Date;
}
export type BeehiivWebhookResult =
  | { kind: 'event'; messageId: string; event: BeehiivEvent }
  | { kind: 'ignored' | 'invalid_signature' | 'invalid_payload' | 'too_large' };

function decode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) return null;
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}
function signedHeaders(input: WebhookInput) {
  const id = input.headers.get('svix-id') ?? '';
  const timestamp = input.headers.get('svix-timestamp') ?? '';
  const signatures = input.headers.get('svix-signature') ?? '';
  const time = Number(timestamp);
  if (
    !/^[A-Za-z0-9_-]{1,200}$/.test(id) ||
    !/^(0|[1-9]\d{0,12})$/.test(timestamp) ||
    !Number.isSafeInteger(time) ||
    !Number.isFinite(input.now.getTime()) ||
    Math.abs(input.now.getTime() - time * 1000) > 300_000 ||
    !signatures ||
    signatures.length > 4096
  )
    return null;
  const candidates = signatures.split(/\s+/);
  return candidates.length <= 20 ? { id, timestamp, candidates } : null;
}
async function authenticated(input: WebhookInput): Promise<string | null> {
  const headers = signedHeaders(input);
  if (!headers || !input.secret.startsWith('whsec_') || input.secret.length > 1024) return null;
  const secret = decode(input.secret.slice(6));
  if (!secret?.length) return null;
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const prefix = new TextEncoder().encode(`${headers.id}.${headers.timestamp}.`);
  const signed = new Uint8Array(prefix.length + input.body.byteLength);
  signed.set(prefix);
  signed.set(input.body, prefix.length);
  for (const candidate of headers.candidates) {
    if (!candidate.startsWith('v1,')) continue;
    const signature = decode(candidate.slice(3));
    if (signature?.length === 32 && (await crypto.subtle.verify('HMAC', key, signature, signed)))
      return headers.id;
  }
  return null;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function id(value: unknown, prefix: string): value is string {
  return (
    typeof value === 'string' && value.startsWith(prefix) && /^[A-Za-z0-9_-]{5,128}$/.test(value)
  );
}
function eventType(value: unknown): value is BeehiivEvent['type'] {
  return (
    value === 'subscription.created' ||
    value === 'subscription.confirmed' ||
    value === 'subscription.deleted'
  );
}
function email(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}
function parseEvent(input: WebhookInput, messageId: string): BeehiivWebhookResult {
  const body: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(input.body),
  );
  if (!record(body) || typeof body.event_type !== 'string') return { kind: 'invalid_payload' };
  if (!eventType(body.event_type)) return { kind: 'ignored' };
  const sourceTime = body.event_timestamp;
  if (
    !id(body.uid, 'evt_') ||
    !record(body.data) ||
    !id(body.data.id, 'sub_') ||
    !email(body.data.email) ||
    typeof sourceTime !== 'number' ||
    !Number.isSafeInteger(sourceTime) ||
    sourceTime < 0 ||
    !Number.isFinite(new Date(sourceTime * 1000).getTime()) ||
    sourceTime * 1000 > input.now.getTime() + 300_000
  )
    return { kind: 'invalid_payload' };
  return {
    kind: 'event',
    messageId,
    event: {
      publicationId: input.publicationId,
      id: body.uid,
      type: body.event_type,
      occurredAt: new Date(sourceTime * 1000).toISOString(),
      subscriptionId: body.data.id,
      email: body.data.email.toLowerCase(),
    },
  };
}

/** Delivery authentication is separate from independent consent and source-event ordering. */
export async function readBeehiivWebhook(input: WebhookInput): Promise<BeehiivWebhookResult> {
  if (input.body.byteLength > 65_536) return { kind: 'too_large' };
  try {
    if (!id(input.publicationId, 'pub_')) return { kind: 'invalid_signature' };
    const messageId = await authenticated(input);
    return messageId ? parseEvent(input, messageId) : { kind: 'invalid_signature' };
  } catch {
    return { kind: 'invalid_payload' };
  }
}
