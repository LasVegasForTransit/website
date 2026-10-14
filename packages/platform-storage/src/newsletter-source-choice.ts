import type { SourceContext } from './newsletter-source-plan';

export interface SourceDecision {
  kind: 'applied' | 'ignored' | 'needs_review';
  reason: string | null;
}
function erasureDecision(context: SourceContext): SourceDecision | null {
  if (!context.erasedAt) return null;
  const removed = Date.parse(context.erasedAt);
  if (Date.parse(context.event.occurred_at) <= removed)
    return { kind: 'ignored', reason: 'account_removed' };
  const selected = context.owner ?? context.candidate;
  if (
    !selected?.email_verified_at ||
    Date.parse(selected.email_verified_at) <= removed ||
    !context.consents.some((consent) => Date.parse(consent.given_at) > removed)
  )
    return { kind: 'needs_review', reason: 'previously_removed_address' };
  return null;
}
function ownershipDecision(context: SourceContext, address: string): SourceDecision | null {
  const { event, owner } = context;
  if (owner?.deleted_at || owner?.erased_at) return { kind: 'ignored', reason: 'account_removed' };
  const erased = erasureDecision(context);
  if (erased) return erased;
  if (context.review) return { kind: 'needs_review', reason: 'ownership_conflict' };
  if (!owner && event.type !== 'subscription.confirmed')
    return { kind: 'needs_review', reason: 'ownership_conflict' };
  if (owner && owner.email?.toLowerCase() !== address)
    return { kind: 'needs_review', reason: 'ownership_conflict' };
  return null;
}
function sourceTimes(context: SourceContext) {
  const at = Date.parse(context.event.occurred_at);
  const withdrawals = [
    ...context.withdrawals.map((row) => Date.parse(row.withdrawn_at)),
    ...context.consents.flatMap((row) => (row.withdrawn_at ? [Date.parse(row.withdrawn_at)] : [])),
    ...context.sourceWithdrawals.map((row) => Date.parse(row.occurred_at)),
  ];
  const consentTimes = context.consents.map((row) => Date.parse(row.given_at));
  return [at, ...withdrawals, ...consentTimes].every(Number.isFinite) ? { at, withdrawals } : null;
}
function superseded(context: SourceContext, times: { at: number; withdrawals: number[] }): boolean {
  return (
    context.event.type === 'subscription.confirmed' &&
    (times.withdrawals.some((value) => value >= times.at) ||
      context.consents.some(
        (value) => value.withdrawn_at === null && Date.parse(value.given_at) >= times.at,
      ))
  );
}
export function decideNewsletterSource(context: SourceContext, address: string): SourceDecision {
  const ownership = ownershipDecision(context, address);
  if (ownership) return ownership;
  if (context.event.type === 'subscription.created')
    return { kind: 'needs_review', reason: 'consent_evidence_needed' };
  const times = sourceTimes(context);
  if (!times) return { kind: 'needs_review', reason: 'source_time_conflict' };
  if (superseded(context, times)) return { kind: 'ignored', reason: 'superseded_choice' };
  const desired = context.event.type === 'subscription.deleted' ? 'inactive' : 'active';
  if (
    context.writes.some(
      (write) =>
        write.desired === desired &&
        times.at >= Math.floor(Date.parse(write.started_at) / 1000) * 1000,
    )
  )
    return { kind: 'needs_review', reason: 'possible_platform_echo' };
  return { kind: 'applied', reason: null };
}
