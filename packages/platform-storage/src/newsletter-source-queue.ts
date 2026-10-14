import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from './db';

export interface PendingNewsletterSource {
  publicationId: string;
  id: string;
  subscriptionId: string;
  emailKey: string;
  encryptedEmail: string | null;
  fingerprint: string;
}

/** Future source clocks wait without blocking ready choices in this publication. */
export async function pendingNewsletterSources(
  db: Db,
  publicationId: string,
  now: Date,
  limit: number,
): Promise<PendingNewsletterSource[]> {
  const { results } = await db
    .prepare(
      `SELECT publication_id AS publicationId,id,subscription_id AS subscriptionId,
      email_key AS emailKey,encrypted_email AS encryptedEmail,fingerprint
      FROM newsletter_inbound_events WHERE publication_id=? AND state='pending'
      AND (julianday(occurred_at) IS NULL OR julianday(occurred_at)<=julianday(?))
      ORDER BY occurred_at,received_at,id LIMIT ?`,
    )
    .bind(publicationId, now.toISOString(), limit)
    .all<PendingNewsletterSource>();
  return results;
}

/** Hold an unreadable address for review only while this exact inbox row remains pending. */
export async function reviewNewsletterSource(
  db: Db,
  event: PendingNewsletterSource,
  reason: 'address_unreadable' | 'address_conflict',
  now: Date,
): Promise<boolean> {
  const nonce = ulid();
  await db.batch([
    db
      .prepare(
        `INSERT INTO newsletter_source_operations(publication_id,event_id,nonce,outcome,reason,created_at)
        SELECT ?,?,?,'needs_review',?,? WHERE EXISTS(SELECT 1 FROM newsletter_inbound_events
          WHERE publication_id=? AND id=? AND state='pending' AND fingerprint=?
          AND subscription_id=? AND email_key=? AND encrypted_email IS ?)
        ON CONFLICT(publication_id,event_id) DO NOTHING`,
      )
      .bind(
        event.publicationId,
        event.id,
        nonce,
        reason,
        now.toISOString(),
        event.publicationId,
        event.id,
        event.fingerprint,
        event.subscriptionId,
        event.emailKey,
        event.encryptedEmail,
      ),
    db
      .prepare(
        `UPDATE newsletter_inbound_events SET state='needs_review' WHERE publication_id=? AND id=?
        AND state='pending' AND EXISTS(SELECT 1 FROM newsletter_source_operations WHERE nonce=?)`,
      )
      .bind(event.publicationId, event.id, nonce),
  ]);
  return Boolean(
    await db
      .prepare('SELECT 1 FROM newsletter_source_operations WHERE nonce=?')
      .bind(nonce)
      .first(),
  );
}
