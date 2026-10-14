const encoder = new TextEncoder();

function encode(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid newsletter intent encoding');
  const bytes = atob(
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4),
  );
  return Uint8Array.from(bytes, (byte) => byte.charCodeAt(0));
}

export interface NewsletterIntentContext {
  id: string;
  publicationId: string;
  personId: string;
}

/** This dedicated jobs-only key must never reuse a session or provider credential. */
export class NewsletterIntentCipher {
  private readonly key: Promise<CryptoKey>;
  constructor(secret: string) {
    const bytes = decode(secret);
    if (bytes.length !== 32) throw new Error('Newsletter intent key must contain 256 bits');
    this.key = crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  private context(value: NewsletterIntentContext): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(
      encoder.encode(
        JSON.stringify(['newsletter-intent-v1', value.publicationId, value.personId, value.id]),
      ),
    );
  }
  async encrypt(email: string, context: NewsletterIntentContext): Promise<string> {
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error('Invalid newsletter intent address');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: this.context(context) },
      await this.key,
      encoder.encode(email),
    );
    return `v1.${encode(iv)}.${encode(new Uint8Array(bytes))}`;
  }
  async decrypt(value: string, context: NewsletterIntentContext): Promise<string> {
    if (value.length > 2048) throw new Error('Invalid newsletter intent');
    const [version, iv, body, ...extra] = value.split('.');
    if (version !== 'v1' || !iv || !body || extra.length || decode(iv).length !== 12)
      throw new Error('Invalid newsletter intent');
    const bytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(iv), additionalData: this.context(context) },
      await this.key,
      decode(body),
    );
    const email = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error('Invalid newsletter intent address');
    return email;
  }
}
