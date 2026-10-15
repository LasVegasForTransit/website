// Membership status is computed, never typed in. The rules are versioned so
// the Membership Model Design project can change who counts as a member by
// adding a version rather than rewriting people's records.

export type MembershipStatus = 'member' | 'former_member' | 'not_member';
export type ConsentScope = 'newsletter' | 'event_reminders' | 'volunteer_contact';

export interface MembershipRule {
  version: number;
  description: string;
  member_if: { active_consent: ConsentScope; current_roll?: boolean };
  former_member_if: { withdrawn_consent: ConsentScope; withdrawn_roll?: boolean };
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

export const MEMBERSHIP_RULES_V2: MembershipRule = {
  version: 2,
  description:
    'A member has active newsletter consent or recognized current membership; unknown history stays unknown.',
  member_if: { active_consent: 'newsletter', current_roll: true },
  former_member_if: { withdrawn_consent: 'newsletter', withdrawn_roll: true },
};

export interface CurrentMembershipRoll {
  entitled: boolean;
  revokedAt: string | null;
}

export function membershipStatus(
  consents: readonly ConsentState[],
  rule: MembershipRule = MEMBERSHIP_RULES_V2,
  roll?: CurrentMembershipRoll,
): MembershipStatus {
  const active = consents.some(
    (consent) => consent.scope === rule.member_if.active_consent && consent.withdrawnAt === null,
  );
  if (active) return 'member';
  const withdrawn = consents.some(
    (consent) =>
      consent.scope === rule.former_member_if.withdrawn_consent && consent.withdrawnAt !== null,
  );
  if (withdrawn || (rule.former_member_if.withdrawn_roll && roll?.revokedAt))
    return 'former_member';
  return rule.member_if.current_roll && roll?.entitled ? 'member' : 'not_member';
}
