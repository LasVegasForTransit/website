import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';

export interface NewsletterSourceEvent {
  publicationId: string;
  id: string;
  messageId: string;
  type: 'subscription.created' | 'subscription.confirmed' | 'subscription.deleted';
  occurredAt: string;
  subscriptionId: string;
  emailKey: string;
  encryptedEmail: string;
  now: Date;
}
/** Call only after authenticating the exact raw payload and encrypting its minimal address. */
export async function saveNewsletterEvent(
  db: Db,
  event: NewsletterSourceEvent,
): Promise<'accepted' | 'conflict'> {
  const fingerprint = await digestToken(
    JSON.stringify([
      event.publicationId,
      event.id,
      event.type,
      event.occurredAt,
      event.subscriptionId,
      event.emailKey,
    ]),
  );
  const received = event.now.toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO newsletter_inbound_events(publication_id,id,fingerprint,type,occurred_at,subscription_id,email_key,encrypted_email,received_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(publication_id,id) DO NOTHING`,
        )
        .bind(
          event.publicationId,
          event.id,
          fingerprint,
          event.type,
          event.occurredAt,
          event.subscriptionId,
          event.emailKey,
          event.encryptedEmail,
          received,
        ),
      db
        .prepare(
          `INSERT INTO newsletter_inbound_deliveries(publication_id,message_id,event_id,received_at) VALUES(?,?,?,?) ON CONFLICT(publication_id,message_id) DO NOTHING`,
        )
        .bind(event.publicationId, event.messageId, event.id, received),
    ]);
    return 'accepted';
  } catch (error) {
    if (error instanceof Error && error.message.includes('newsletter_event_conflict'))
      return 'conflict';
    throw error;
  }
}
