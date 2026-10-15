import { MEMBERSHIP_STATUS_SQL, CURRENT_MEMBERSHIP_VERSION } from './membership-policy';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db, SqlValue } from './db';

export type NewsletterConflictPolicy = 'keep_unsubscribed' | 'staff_review';
interface PollContext {
  choice: {
    revision: number;
    status: string;
    observed_at: string;
    baseline_active_at: string | null;
    state: string;
    person_id: string | null;
  } | null;
  currentStatus: string;
  owner: {
    id: string;
    deleted_at: string | null;
    erased_at: string | null;
    linked_at: string;
    updated_at: string;
  } | null;
  consents: { id: string; given_at: string; withdrawn_at: string | null }[];
  roll: { entitled: number; observedAt: string }[];
}
const CONTEXT = `SELECT json_object(
  'choice',json((SELECT json_object('revision',revision,'status',status,'observed_at',observed_at,'baseline_active_at',baseline_active_at,'state',state,'person_id',person_id) FROM newsletter_poll_choices WHERE publication_id=?1 AND subscription_id=?2)),
  'currentStatus',(SELECT status FROM beehiiv_subscription_observations WHERE publication_id=?1 AND subscription_id=?2),
  'owner',json((SELECT json_object('id',i.person_id,'deleted_at',k.deleted_at,'erased_at',k.erased_at,'linked_at',i.linked_at,'updated_at',i.updated_at)
    FROM identities i JOIN person_keys k ON k.id=i.person_id WHERE i.platform='beehiiv' AND i.external_id=?2)),
  'roll',json((SELECT json_group_array(json_object('entitled',entitled,'observedAt',observed_at)) FROM (SELECT r.entitled,r.observed_at FROM membership_roll r JOIN identities i ON i.person_id=r.person_id AND i.external_id=r.external_id AND i.platform='beehiiv' WHERE i.external_id=?2 ORDER BY r.external_id))),
  'consents',json((SELECT json_group_array(json_object('id',id,'given_at',given_at,'withdrawn_at',withdrawn_at)) FROM (
    SELECT c.id,c.given_at,c.withdrawn_at FROM consent_records c JOIN identities i ON i.person_id=c.person_id
    WHERE i.platform='beehiiv' AND i.external_id=?2 AND c.scope='newsletter' ORDER BY c.id)))) AS snapshot`;
interface Decision {
  kind: 'applied' | 'ignored' | 'needs_review';
  reason: string | null;
  withdraw: boolean;
}
function decide(
  context: PollContext & { choice: NonNullable<PollContext['choice']> },
  policy: NewsletterConflictPolicy,
): Decision {
  const { choice, owner } = context;
  const result = (kind: Decision['kind'], reason: string | null = null, withdraw = false) => ({
    kind,
    reason,
    withdraw,
  });
  if (choice.status !== context.currentStatus) return result('ignored', 'delivery_changed');
  if (!owner) return result('needs_review', 'unlinked_account');
  if (accountRemoved(owner)) return result('ignored', 'account_removed');
  if (
    ![choice.observed_at, owner.linked_at, owner.updated_at].every((value) =>
      Number.isFinite(Date.parse(value)),
    )
  )
    return result('needs_review', 'source_time_unknown');
  const active = context.consents.filter((value) => value.withdrawn_at === null);
  const roll = context.roll.filter((value) => value.entitled === 1);
  if (choice.status === 'active')
    return active.length || roll.length
      ? result('applied')
      : result('needs_review', 'consent_evidence_needed');
  const observed = Date.parse(choice.observed_at);
  if (active.some((value) => Date.parse(value.given_at) > observed))
    return result('ignored', 'newer_signup');
  if (Date.parse(owner.linked_at) > observed || Date.parse(owner.updated_at) > observed)
    return result('needs_review', 'ownership_changed');
  if (!active.length && !roll.length) return result('applied');
  const baseline = choice.baseline_active_at ? Date.parse(choice.baseline_active_at) : NaN;
  const uncertain = uncertainChoice(baseline, observed, active, roll);
  if (uncertain)
    return result('needs_review', 'choice_order_unknown', policy === 'keep_unsubscribed');
  return result('applied', null, true);
}
function uncertainChoice(
  baseline: number,
  observed: number,
  active: PollContext['consents'],
  roll: PollContext['roll'],
) {
  return (
    !Number.isFinite(baseline) ||
    baseline > observed ||
    roll.some(
      (value) =>
        !Number.isFinite(Date.parse(value.observedAt)) || Date.parse(value.observedAt) > baseline,
    ) ||
    active.some(
      (value) =>
        !Number.isFinite(Date.parse(value.given_at)) || Date.parse(value.given_at) > baseline,
    )
  );
}
function accountRemoved(owner: NonNullable<PollContext['owner']>) {
  return owner.deleted_at !== null || owner.erased_at !== null;
}
interface PollWithdrawal {
  personId: string;
  subscriptionId: string;
  revision: number;
  at: string;
  stamp: string;
  nonce: string;
}
function withdrawalWrites(db: Db, input: PollWithdrawal) {
  const { personId, subscriptionId, revision, at, stamp, nonce } = input;
  const held = 'EXISTS(SELECT 1 FROM newsletter_poll_operations WHERE nonce=?)';
  return [
    db
      .prepare(
        `INSERT INTO consent_withdrawals(id,person_id,origin_person_id,scope,source,withdrawn_at,recorded_at,time_basis,source_occurred_at)
        SELECT ?,?,?,'newsletter','beehiiv_observed',?,?,'observed',NULL WHERE ${held}
        ON CONFLICT(origin_person_id,scope,source,withdrawn_at) DO NOTHING`,
      )
      .bind(ulid(), personId, personId, at, stamp, nonce),
    db
      .prepare(
        `UPDATE consent_records SET withdrawn_at=?,withdrawn_source='beehiiv_observed',withdrawn_time_basis='observed',updated_at=?
        WHERE person_id=? AND scope='newsletter' AND withdrawn_at IS NULL AND (julianday(given_at) IS NULL OR julianday(given_at)<=julianday(?)) AND ${held}`,
      )
      .bind(at, stamp, personId, at, nonce),
    db
      .prepare(
        `INSERT INTO engagement_events(id,person_id,type,occurred_at,source,reference,details,created_at)
        SELECT ?,?,'unsubscribed',?,'beehiiv_observed',?,?,? WHERE ${held}`,
      )
      .bind(
        ulid(),
        personId,
        at,
        `${subscriptionId}:${revision}`,
        JSON.stringify({ timeBasis: 'observed', originalChoiceAt: null }),
        stamp,
        nonce,
      ),
    db
      .prepare(
        `UPDATE people SET membership_status=${MEMBERSHIP_STATUS_SQL},membership_rules_version=${CURRENT_MEMBERSHIP_VERSION},updated_at=? WHERE id=? AND deleted_at IS NULL AND ${held}`,
      )
      .bind(stamp, personId, nonce),
  ];
}
async function applyOne(
  db: Db,
  subscriptionId: string,
  options: { publicationId: string; policy: NewsletterConflictPolicy; now: Date },
) {
  const { publicationId, policy, now } = options;
  const row = await db
    .prepare(CONTEXT)
    .bind(publicationId, subscriptionId)
    .first<{ snapshot: string }>();
  if (!row) return 'stale' as const;
  const context = JSON.parse(row.snapshot) as PollContext;
  const choice = context.choice;
  if (
    !choice ||
    !['pending', 'needs_review'].includes(choice.state) ||
    Date.parse(choice.observed_at) > now.getTime()
  )
    return 'stale' as const;
  const decision = decide({ ...context, choice }, policy),
    nonce = ulid(),
    personId = context.owner?.id ?? null,
    stamp = now.toISOString();
  const values: SqlValue[] = [];
  const snapshot = CONTEXT.replace(/\?([12])/g, (_match, index: string) => {
    values.push(index === '1' ? publicationId : subscriptionId);
    return '?';
  });
  const held = 'EXISTS(SELECT 1 FROM newsletter_poll_operations WHERE nonce=?)';
  const statements = [
    db
      .prepare(
        `INSERT INTO newsletter_poll_operations(publication_id,subscription_id,revision,nonce,person_id,outcome,reason,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE (${snapshot})=? ON CONFLICT(publication_id,subscription_id,revision) DO NOTHING`,
      )
      .bind(
        publicationId,
        subscriptionId,
        choice.revision,
        nonce,
        personId,
        decision.kind,
        decision.reason,
        stamp,
        ...values,
        row.snapshot,
      ),
  ];
  if (decision.withdraw && personId)
    statements.push(
      ...withdrawalWrites(db, {
        personId,
        subscriptionId,
        revision: choice.revision,
        at: choice.observed_at,
        stamp,
        nonce,
      }),
    );
  statements.push(
    db
      .prepare(
        `UPDATE newsletter_poll_choices SET state=?,reason=?,person_id=?,processed_at=?
    WHERE publication_id=? AND subscription_id=? AND revision=? AND ${held}`,
      )
      .bind(
        decision.kind,
        decision.reason,
        personId,
        stamp,
        publicationId,
        subscriptionId,
        choice.revision,
        nonce,
      ),
  );
  await db.batch(statements);
  return (await operationApplied(db, nonce)) ? decision.kind : ('stale' as const);
}
async function operationApplied(db: Db, nonce: string) {
  return Boolean(
    await db.prepare('SELECT 1 FROM newsletter_poll_operations WHERE nonce=?').bind(nonce).first(),
  );
}

/** Current status and explicit source time remain distinct. No observation creates consent. */
export async function processNewsletterPollChoices(
  db: Db,
  options: { publicationId: string; policy: NewsletterConflictPolicy; now: Date; limit?: number },
) {
  if (
    !/^pub_[A-Za-z0-9_-]{1,124}$/.test(options.publicationId) ||
    !Number.isFinite(options.now.getTime()) ||
    !['keep_unsubscribed', 'staff_review'].includes(options.policy)
  )
    throw new Error('Invalid newsletter observation configuration');
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(3, Math.floor(options.limit ?? 3)))
    : 3;
  const { results } = await db
    .prepare(
      `SELECT r.subscription_id FROM newsletter_poll_choices r
    WHERE r.publication_id=? AND r.observed_at<=? AND (r.state='pending' OR (r.state='needs_review' AND r.person_id IS NULL AND EXISTS(
      SELECT 1 FROM identities i WHERE i.platform='beehiiv' AND i.external_id=r.subscription_id)))
    ORDER BY (r.status='inactive') DESC,r.observed_at,r.subscription_id LIMIT ?`,
    )
    .bind(options.publicationId, options.now.toISOString(), limit)
    .all<{ subscription_id: string }>();
  const counts = { processed: 0, applied: 0, ignored: 0, review: 0, stale: 0 };
  for (const row of results) {
    const kind = await applyOne(db, row.subscription_id, options);
    if (kind === 'needs_review') counts.review++;
    else counts[kind]++;
    if (kind !== 'stale') counts.processed++;
  }
  return {
    kind: results.length ? ('progress' as const) : ('idle' as const),
    ...counts,
    more: results.length === limit,
  };
}
