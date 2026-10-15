import { MEMBERSHIP_STATUS_SQL, CURRENT_MEMBERSHIP_VERSION } from './membership-policy';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Actor, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db, SqlValue, Statement } from './db';
import { STAFF_ADMIN_SCOPE } from './staff-scope';
import { newsletterEmailKey } from './newsletter-work';
import {
  loadReviewContext,
  recordedChoiceAllowed,
  mailingStatusAllowed,
  reviewSnapshotGuard,
  type NewsletterReviewRef,
} from './newsletter-review-context';

export interface NewsletterReviewDecision extends NewsletterReviewRef {
  version: string;
  operationId: string;
  action: 'unsubscribe' | 'recorded_choice';
  note: string;
  now: Date;
}
function valid(input: NewsletterReviewDecision) {
  return (
    /^[A-Za-z0-9_-]{43}$/.test(input.version) &&
    input.operationId.trim().length > 0 &&
    input.operationId.length <= 200 &&
    ['unsubscribe', 'recorded_choice'].includes(input.action) &&
    input.note.length <= 2000 &&
    Number.isFinite(input.now.getTime())
  );
}
interface Transaction {
  operationId: string;
  actorId: string;
  target: string;
  payload: string;
  stamp: string;
  personId: string;
  publicationId: string;
  note: string;
  effectiveAt: string;
  hadActive: boolean;
  choiceSource: string;
  timeBasis: 'choice' | 'observed';
  sourceTime: string | null;
}
const HELD =
  "EXISTS(SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND kind='newsletter.review' AND target_id=? AND payload=? AND applied_at IS NULL)";
function held(tx: Transaction) {
  return [tx.operationId, tx.actorId, tx.target, tx.payload];
}
function mutation(db: Db, tx: Transaction, sql: string, values: SqlValue[]): Statement {
  return db.prepare(sql.replace('__HELD__', HELD)).bind(...values, ...held(tx));
}
function unsubscribeWrites(db: Db, tx: Transaction): Statement[] {
  return [
    mutation(
      db,
      tx,
      `INSERT INTO consent_withdrawals(id,person_id,origin_person_id,scope,source,withdrawn_at,recorded_at,time_basis,source_occurred_at)
      SELECT ?,?,?,'newsletter',?,?,?,?,? WHERE __HELD__ ON CONFLICT(origin_person_id,scope,source,withdrawn_at) DO NOTHING`,
      [
        ulid(),
        tx.personId,
        tx.personId,
        tx.choiceSource,
        tx.effectiveAt,
        tx.stamp,
        tx.timeBasis,
        tx.sourceTime,
      ],
    ),
    mutation(
      db,
      tx,
      `UPDATE consent_records SET withdrawn_at=?,withdrawn_source=?,withdrawn_time_basis=?,updated_at=?
      WHERE person_id=? AND scope='newsletter' AND withdrawn_at IS NULL AND julianday(given_at)<=julianday(?) AND __HELD__`,
      [tx.effectiveAt, tx.choiceSource, tx.timeBasis, tx.stamp, tx.personId, tx.effectiveAt],
    ),
    mutation(
      db,
      tx,
      `INSERT INTO engagement_events(id,person_id,type,occurred_at,source,reference,details,created_at)
      SELECT ?,?,'unsubscribed',?,?,?,?,? WHERE ? AND __HELD__`,
      [
        ulid(),
        tx.personId,
        tx.effectiveAt,
        tx.choiceSource,
        tx.operationId,
        JSON.stringify({ timeBasis: tx.timeBasis, originalChoiceAt: tx.sourceTime }),
        tx.stamp,
        Number(tx.hadActive),
      ],
    ),
    mutation(
      db,
      tx,
      `UPDATE people SET membership_status=${MEMBERSHIP_STATUS_SQL},membership_rules_version=${CURRENT_MEMBERSHIP_VERSION},updated_at=? WHERE id=? AND __HELD__`,
      [tx.stamp, tx.personId],
    ),
  ];
}
function finishWrites(db: Db, tx: Transaction, input: NewsletterReviewDecision): Statement[] {
  const state = input.action === 'unsubscribe' ? 'applied' : 'ignored';
  const choice =
    input.kind === 'poll'
      ? mutation(
          db,
          tx,
          `UPDATE newsletter_poll_choices SET state=?,reason='staff_reviewed',person_id=?,processed_at=? WHERE publication_id=? AND subscription_id=? AND revision=? AND state='needs_review' AND __HELD__`,
          [state, tx.personId, tx.stamp, tx.publicationId, input.id, input.revision],
        )
      : mutation(
          db,
          tx,
          `UPDATE newsletter_inbound_events SET state=?,encrypted_email=NULL WHERE publication_id=? AND id=? AND state='needs_review' AND __HELD__`,
          [state, tx.publicationId, input.id],
        );
  return [
    choice,
    mutation(
      db,
      tx,
      `INSERT INTO staff_audits(id,actor_id,action,target_id,details,operation_id,occurred_at) SELECT ?,?,'newsletter.review',?,?,?,? WHERE __HELD__`,
      [ulid(), tx.actorId, tx.personId, tx.payload, tx.operationId, tx.stamp],
    ),
    mutation(
      db,
      tx,
      `UPDATE staff_operations SET applied_at=?,result=? WHERE operation_id=? AND __HELD__`,
      [tx.stamp, JSON.stringify({ personId: tx.personId }), tx.operationId],
    ),
  ];
}
async function replay(
  db: Db,
  tx: Pick<Transaction, 'actorId' | 'operationId' | 'target' | 'payload'>,
): Promise<MutationResult<{ personId: string }> | null> {
  const prior = await db
    .prepare(
      'SELECT actor_id,target_id,payload,kind,applied_at,result FROM staff_operations WHERE operation_id=?',
    )
    .bind(tx.operationId)
    .first<{
      actor_id: string;
      target_id: string;
      payload: string;
      kind: string;
      applied_at: string | null;
      result: string | null;
    }>();
  if (!prior) return null;
  return prior.actor_id === tx.actorId &&
    prior.target_id === tx.target &&
    prior.payload === tx.payload &&
    prior.kind === 'newsletter.review' &&
    prior.applied_at &&
    prior.result
    ? { kind: 'ok', value: JSON.parse(prior.result) as { personId: string } }
    : { kind: 'conflict' };
}
function currentChoice(
  loaded: NonNullable<Awaited<ReturnType<typeof loadReviewContext>>>,
  input: NewsletterReviewDecision,
): boolean {
  return (
    input.version === loaded.version &&
    Number.isFinite(Date.parse(loaded.context.review?.cutoff ?? '')) &&
    Date.parse(loaded.context.review?.cutoff ?? '') <= input.now.getTime() &&
    loaded.context.active.every(
      (v) => Number.isFinite(Date.parse(v.givenAt)) && Date.parse(v.givenAt) <= input.now.getTime(),
    )
  );
}
async function signupWrite(
  db: Db,
  tx: Transaction,
  context: NonNullable<Awaited<ReturnType<typeof loadReviewContext>>>['context'],
) {
  const consent = context.active
      .slice()
      .sort((a, b) => Date.parse(b.givenAt) - Date.parse(a.givenAt))[0],
    owner = context.owner;
  return mutation(
    db,
    tx,
    `UPDATE newsletter_sync_jobs SET generation=generation+1,state='queued',requested_at=?,next_attempt_at=?,last_failure=NULL,activation_consent_id=?,activation_email_key=?,activation_email_verified_at=? WHERE person_id=? AND __HELD__`,
    [
      tx.stamp,
      tx.stamp,
      consent?.id ?? null,
      await newsletterEmailKey(owner?.email ?? ''),
      owner?.verifiedAt ?? null,
      tx.personId,
    ],
  );
}
function decisionAllowed(
  context: NonNullable<Awaited<ReturnType<typeof loadReviewContext>>>['context'],
  action: NewsletterReviewDecision['action'],
) {
  return action === 'recorded_choice'
    ? recordedChoiceAllowed(context)
    : mailingStatusAllowed(context);
}
function choiceProvenance(
  kind: NewsletterReviewRef['kind'],
  cutoff: string,
): Pick<Transaction, 'choiceSource' | 'timeBasis' | 'sourceTime'> {
  return kind === 'event'
    ? { choiceSource: 'beehiiv', timeBasis: 'choice', sourceTime: cutoff }
    : { choiceSource: 'beehiiv_observed', timeBasis: 'observed', sourceTime: null };
}
export async function resolveNewsletterReview(
  db: Db,
  actor: Actor,
  publicationId: string,
  input: NewsletterReviewDecision,
): Promise<MutationResult<{ personId: string }>> {
  if (!(await db.prepare(`SELECT 1 WHERE ${STAFF_ADMIN_SCOPE}`).bind(actor.personId).first()))
    return { kind: 'forbidden' };
  if (!valid(input)) return { kind: 'invalid' };
  const target = JSON.stringify([publicationId, input.kind, input.id, input.revision]);
  const payload = JSON.stringify({
    publicationId,
    action: input.action,
    note: input.note.trim(),
    version: input.version,
  });
  const prior = await replay(db, {
    actorId: actor.personId,
    operationId: input.operationId,
    target,
    payload,
  });
  if (prior) return prior;
  const loaded = await loadReviewContext(db, actor.personId, publicationId, input);
  const owner = loaded?.context.owner,
    review = loaded?.context.review;
  if (!loaded || !owner?.id || !review) return { kind: 'conflict' };
  if (!currentChoice(loaded, input)) return { kind: 'conflict' };
  if (!decisionAllowed(loaded.context, input.action)) return { kind: 'conflict' };
  const tx: Transaction = {
    operationId: input.operationId,
    actorId: actor.personId,
    target,
    payload,
    stamp: input.now.toISOString(),
    personId: owner.id,
    publicationId,
    note: input.note.trim(),
    effectiveAt: review.cutoff,
    hadActive: loaded.context.active.length > 0 || loaded.context.rollEntitled === 1,
    ...choiceProvenance(input.kind, review.cutoff),
  };
  const guard = reviewSnapshotGuard(actor.personId, publicationId, input, loaded.snapshot);
  const statements = [
    db
      .prepare(
        `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at) SELECT ?,?,'newsletter.review',?,?,? WHERE ${guard.sql} ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(tx.operationId, tx.actorId, target, payload, tx.stamp, ...guard.values),
  ];
  if (input.action === 'unsubscribe') statements.push(...unsubscribeWrites(db, tx));
  else statements.push(await signupWrite(db, tx, loaded.context));
  statements.push(...finishWrites(db, tx, input));
  await db.batch(statements);
  const applied = await db
    .prepare(
      'SELECT 1 FROM staff_operations WHERE operation_id=? AND actor_id=? AND target_id=? AND payload=? AND applied_at IS NOT NULL',
    )
    .bind(input.operationId, actor.personId, target, payload)
    .first();
  return applied ? { kind: 'ok', value: { personId: owner.id } } : { kind: 'conflict' };
}
