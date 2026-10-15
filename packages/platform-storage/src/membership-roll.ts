import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, SqlValue, Statement } from './db';
import { newsletterEmailKey } from './newsletter-work';
import { loadRollContext, ROLL_CONTEXT, eligibleRollContext } from './membership-roll-context';

import { validObservation, type CurrentMembershipObservation } from './membership-roll-input';
import {
  rollReplay,
  observationInOrder,
  rollReviewReason,
  proposedRoll,
} from './membership-roll-policy';
export type { CurrentMembershipObservation } from './membership-roll-input';
export type CurrentMembershipResult = 'applied' | 'already_applied' | 'needs_review';
const HELD =
  'EXISTS(SELECT 1 FROM membership_roll WHERE external_id=? AND person_id=? AND revision_token=?)';
function withdrawalWrites(db: Db, input: CurrentMembershipObservation, nonce: string): Statement[] {
  if (!input.withdrawnAt) return [];
  const held: SqlValue[] = [input.externalId, input.personId, nonce];
  return [
    db
      .prepare(
        `UPDATE consent_records SET withdrawn_at=?,withdrawn_source='beehiiv',updated_at=? WHERE person_id=? AND scope='newsletter' AND withdrawn_at IS NULL AND (julianday(given_at) IS NULL OR julianday(given_at)<=julianday(?)) AND ${HELD}`,
      )
      .bind(input.withdrawnAt, input.observedAt, input.personId, input.withdrawnAt, ...held),
    db
      .prepare(
        `INSERT INTO consent_withdrawals(id,person_id,origin_person_id,scope,source,withdrawn_at,recorded_at,time_basis,source_occurred_at) SELECT ?,?,?,'newsletter','beehiiv',?,?,'choice',? WHERE ${HELD} ON CONFLICT(origin_person_id,scope,source,withdrawn_at) DO NOTHING`,
      )
      .bind(
        ulid(),
        input.personId,
        input.personId,
        input.withdrawnAt,
        input.observedAt,
        input.withdrawnAt,
        ...held,
      ),
  ];
}

/** Recognize the current roll without backfilling historical consent or dates. */
export async function recordCurrentMembershipRoll(
  db: Db,
  input: CurrentMembershipObservation,
): Promise<CurrentMembershipResult> {
  if (!validObservation(input)) return 'needs_review';
  const first = await db
    .prepare('SELECT email FROM people WHERE id=? AND deleted_at IS NULL')
    .bind(input.personId)
    .first<{ email: string | null }>();
  if (!first?.email) return 'needs_review';
  const values: SqlValue[] = [
    input.personId,
    input.externalId,
    await newsletterEmailKey(first.email),
  ];
  const loaded = await loadRollContext(db, values);
  if (!loaded) return 'needs_review';
  const { context } = loaded;
  if (
    !eligibleRollContext(context, input.personId, first.email) ||
    !observationInOrder(context, input)
  )
    return 'needs_review';
  const review = rollReviewReason(context, input);
  const replay = rollReplay(context, input, review);
  if (replay) return replay;
  const { entitled, recognizedAt, revokedAt, withdraw } = proposedRoll(context, input, review);
  const nonce = ulid();
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO membership_roll(external_id,person_id,status,observed_at,source_created_at,withdrawn_at,entitled,recognized_at,revoked_at,review_reason,revision_token)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (${ROLL_CONTEXT})=?
      ON CONFLICT(external_id) DO UPDATE SET status=excluded.status,observed_at=excluded.observed_at,source_created_at=excluded.source_created_at,withdrawn_at=excluded.withdrawn_at,entitled=excluded.entitled,recognized_at=excluded.recognized_at,revoked_at=excluded.revoked_at,review_reason=excluded.review_reason,revision_token=excluded.revision_token WHERE membership_roll.person_id=excluded.person_id`,
      )
      .bind(
        input.externalId,
        input.personId,
        input.status,
        input.observedAt,
        input.sourceCreatedAt ?? null,
        input.withdrawnAt ?? null,
        entitled,
        recognizedAt,
        revokedAt,
        review,
        nonce,
        ...values,
        loaded.snapshot,
      ),
    ...(withdraw ? withdrawalWrites(db, input, nonce) : []),
  ]);
  const saved = result[0] as { meta: { changes: number } };
  return saved.meta.changes > 0 ? (review ? 'needs_review' : 'applied') : 'needs_review';
}
