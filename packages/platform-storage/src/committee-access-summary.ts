import type { CommitteeProviderSummary } from './committee-access-types';
import type { GoogleGroupSummary } from './google-group-overview';
export function unknown(
  resourceId: string | null,
  state: CommitteeProviderSummary['state'],
): CommitteeProviderSummary {
  return {
    resourceId,
    state,
    holders: null,
    missing: null,
    unexpected: null,
    unconfirmed: 0,
    unmatched: 0,
    checkedAt: null,
    firstSeenAt: null,
  };
}
export function googleSummary(
  group: GoogleGroupSummary | undefined,
  resourceId: string | null,
): CommitteeProviderSummary {
  if (!group) return unknown(resourceId, resourceId ? 'not_configured' : 'not_mapped');
  return {
    resourceId,
    state:
      group.state === 'current'
        ? 'current'
        : group.state === 'not_configured'
          ? 'not_configured'
          : 'unknown',
    holders: group.userCount,
    missing: group.missingCount,
    unexpected: group.unexpectedCount,
    unconfirmed: group.unconfirmedCount ?? 0,
    unmatched: group.unmatchedCount ?? 0,
    checkedAt: group.checkedAt,
    firstSeenAt: null,
  };
}
