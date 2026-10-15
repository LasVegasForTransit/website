import type { RollContext } from './membership-roll-context';
import type { CurrentMembershipObservation } from './membership-roll-input';

export function sameObservation(context: RollContext, input: CurrentMembershipObservation) {
  const row = context.roll;
  return (
    row?.personId === input.personId &&
    row.observedAt === input.observedAt &&
    row.status === input.status &&
    row.sourceCreatedAt === (input.sourceCreatedAt ?? null) &&
    row.withdrawnAt === (input.withdrawnAt ?? null)
  );
}
export function rollReplay(
  context: RollContext,
  input: CurrentMembershipObservation,
  review: string | null,
): 'needs_review' | 'already_applied' | null {
  if (!sameObservation(context, input)) return null;
  if (review) return 'needs_review';
  return context.roll?.reviewReason ? null : 'already_applied';
}
export function observationInOrder(context: RollContext, input: CurrentMembershipObservation) {
  const previous = context.roll;
  if (!previous) return true;
  const before = Date.parse(previous.observedAt),
    after = Date.parse(input.observedAt);
  return before < after || (before === after && sameObservation(context, input));
}
function chronology(context: RollContext) {
  const active = context.active.map(Date.parse);
  const withdrawals = [
    ...context.withdrawals,
    ...(context.roll?.revokedAt ? [context.roll.revokedAt] : []),
  ].map(Date.parse);
  return {
    valid: [...active, ...withdrawals].every(Number.isFinite),
    latestActive: Math.max(-Infinity, ...active),
    latestWithdrawal: Math.max(-Infinity, ...withdrawals),
  };
}
function activeReason(
  context: RollContext,
  input: CurrentMembershipObservation,
  latestActive: number,
  latestWithdrawal: number,
) {
  if (latestWithdrawal >= latestActive && latestWithdrawal !== -Infinity) return 'prior_choice';
  if (context.outgoing && Date.parse(context.outgoing) >= latestActive) return 'prior_choice';
  return latestActive > Date.parse(input.observedAt) ? 'newer_signup' : null;
}
export function rollReviewReason(
  context: RollContext,
  input: CurrentMembershipObservation,
): string | null {
  if (context.duplicate) return 'duplicate_review';
  if (context.choice) return 'pending_choice';
  if (
    context.roll?.reviewReason === 'choice_order_unknown' &&
    !(input.status === 'inactive' && input.withdrawnAt)
  )
    return 'pending_choice';
  const { valid, latestActive, latestWithdrawal } = chronology(context);
  if (!valid) return 'choice_order_unknown';
  if (input.status === 'active')
    return activeReason(context, input, latestActive, latestWithdrawal);
  if (input.status !== 'inactive') return 'membership_status_unknown';
  if (!input.withdrawnAt) return 'choice_order_unknown';
  return latestActive > Date.parse(input.withdrawnAt) ? 'newer_signup' : null;
}
function revokedAt(
  context: RollContext,
  input: CurrentMembershipObservation,
  active: boolean,
  withdraw: boolean,
) {
  const previous = context.roll?.revokedAt ?? null;
  if (active) return null;
  if (!withdraw) return previous;
  return previous && Date.parse(previous) > Date.parse(input.withdrawnAt ?? '')
    ? previous
    : (input.withdrawnAt ?? null);
}
export function proposedRoll(
  context: RollContext,
  input: CurrentMembershipObservation,
  review: string | null,
) {
  const active = input.status === 'active' && !review,
    withdraw = input.status === 'inactive' && Boolean(input.withdrawnAt) && !review;
  return {
    withdraw,
    entitled: active ? 1 : withdraw ? 0 : (context.roll?.entitled ?? 0),
    recognizedAt: context.roll?.recognizedAt ?? (active ? input.observedAt : null),
    revokedAt: revokedAt(context, input, active, withdraw),
  };
}
