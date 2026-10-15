import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { saveNewsletterEvent } from '@lasvegasfortransit/platform-storage/newsletter-inbound';
import { newsletterEmailKey } from '@lasvegasfortransit/platform-storage/newsletter-work';
import { beehiivRuntime, type BeehiivRuntimeEnv } from './beehiiv-runtime';
import { beehiivWebhookSecret, readBeehiivWebhook } from './beehiiv-webhook';
import { NewsletterEventCipher } from './newsletter-event-cipher';

export interface BeehiivEventRuntimeEnv extends BeehiivRuntimeEnv {
  LVBT_BEEHIIV_WEBHOOK_SECRET?: string;
}
/** Never buffer an unbounded request, including when Content-Length is absent or false. */
export async function readNewsletterBody(
  request: Request,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const value: unknown = result.value;
      if (!(value instanceof Uint8Array)) throw new Error('Invalid newsletter request body');
      if (value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Acknowledge only authenticated minimal evidence committed to the durable inbox. */
export async function receiveBeehiivEvent(
  db: Db,
  env: BeehiivEventRuntimeEnv,
  input: { body: Uint8Array; headers: Headers; now: Date },
): Promise<number> {
  const runtime = beehiivRuntime(env),
    secret = env.LVBT_BEEHIIV_WEBHOOK_SECRET;
  if (!runtime || !secret || !beehiivWebhookSecret(secret)) return 503;
  const result = await readBeehiivWebhook({
    ...input,
    secret,
    publicationId: runtime.configuration.publicationId,
  });
  if (result.kind !== 'event')
    return { invalid_signature: 401, invalid_payload: 400, too_large: 413, ignored: 200 }[
      result.kind
    ];
  const event = result.event,
    emailKey = await newsletterEmailKey(event.email);
  const context = {
    id: event.id,
    publicationId: event.publicationId,
    subscriptionId: event.subscriptionId,
    emailKey,
  };
  const encryptedEmail = await new NewsletterEventCipher(runtime.intentKey).encrypt(
    event.email,
    context,
  );
  const saved = await saveNewsletterEvent(db, {
    ...event,
    emailKey,
    encryptedEmail,
    messageId: result.messageId,
    now: input.now,
  });
  return saved === 'accepted' ? 200 : 409;
}
