// Membership status is computed, never typed in. The rules are versioned so
// the Membership Model Design project can change who counts as a member by
// adding a version rather than rewriting people's records.

export type MembershipStatus = 'member' | 'former_member' | 'not_member';
export type ConsentScope = 'newsletter' | 'event_reminders' | 'volunteer_contact';

export interface MembershipRule {
  version: number;
  description: string;
  member_if: { active_consent: ConsentScope };
  former_member_if: { withdrawn_consent: ConsentScope };
}

export interface ConsentState {
  scope: ConsentScope;
  withdrawnAt: string | null;
}

export const MEMBERSHIP_RULES_V1: MembershipRule = {
  version: 1,
  description: 'A member is anyone with an active newsletter consent.',
  member_if: { active_consent: 'newsletter' },
  former_member_if: { withdrawn_consent: 'newsletter' },
};

export function membershipStatus(
  consents: readonly ConsentState[],
  rule: MembershipRule = MEMBERSHIP_RULES_V1,
): MembershipStatus {
  const active = consents.some(
    (consent) => consent.scope === rule.member_if.active_consent && consent.withdrawnAt === null,
  );
  if (active) return 'member';
  const withdrawn = consents.some(
    (consent) =>
      consent.scope === rule.former_member_if.withdrawn_consent && consent.withdrawnAt !== null,
  );
  return withdrawn ? 'former_member' : 'not_member';
}
