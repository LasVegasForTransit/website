import type { Db } from './db';
import { newsletterEmailKey } from './newsletter-work';

/** Carry an existing preference to the inbox the member just confirmed. */
export async function confirmNewsletterAddress(
  db: Db,
  input: { personId: string; email: string; verifiedAt: string },
): Promise<void> {
  const { personId, email, verifiedAt } = input;
  if (!Number.isFinite(Date.parse(verifiedAt)))
    throw new Error('Invalid newsletter address confirmation');
  const key = await newsletterEmailKey(email);
  await db.batch([
    db
      .prepare(
        'UPDATE people SET email_verified_at=? WHERE id=? AND email=? AND deleted_at IS NULL',
      )
      .bind(verifiedAt, personId, email),
    db
      .prepare(
        `UPDATE newsletter_sync_jobs SET generation=generation+1,state='queued',requested_at=?,next_attempt_at=?,last_failure=NULL,activation_email_key=?,activation_email_verified_at=?,activation_consent_id=(SELECT id FROM consent_records WHERE person_id=? AND scope='newsletter' AND withdrawn_at IS NULL ORDER BY julianday(given_at) DESC,id DESC LIMIT 1) WHERE person_id=? AND EXISTS(SELECT 1 FROM people WHERE id=? AND email=? AND email_verified_at=? AND deleted_at IS NULL) AND EXISTS(SELECT 1 FROM consent_records WHERE person_id=? AND scope='newsletter' AND withdrawn_at IS NULL)`,
      )
      .bind(
        verifiedAt,
        verifiedAt,
        key,
        verifiedAt,
        personId,
        personId,
        personId,
        email,
        verifiedAt,
        personId,
      ),
  ]);
}
