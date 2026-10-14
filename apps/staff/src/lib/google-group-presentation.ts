import type { GoogleGroupSummary } from '@lasvegasfortransit/platform-storage/google-group-overview';
import { t } from '@lasvegasfortransit/platform-core/messages';
export function googleGroupName(group: GoogleGroupSummary): string {
  return group.isConsole
    ? t('staff.googleGroups.staffSignIn')
    : group.committees.map((c) => c.name).join(' / ');
}
export function googleGroupProblemCount(group: GoogleGroupSummary): number {
  return (
    (group.missingCount ?? 0) +
    (group.unexpectedCount ?? 0) +
    (group.unconfirmedCount ?? 0) +
    (group.unmatchedCount ?? 0)
  );
}
export function googleGroupStatus(group: GoogleGroupSummary): string {
  if (group.state !== 'current')
    return {
      stale: t('staff.googleGroups.stale'),
      unavailable: t('staff.googleGroups.unavailable'),
      not_checked: t('staff.googleGroups.not_checked'),
      not_configured: t('staff.googleGroups.not_configured'),
      needs_review: t('staff.googleGroups.needs_review'),
    }[group.state];
  const count = googleGroupProblemCount(group);
  return count ? t('staff.googleGroups.problems', { count }) : t('staff.googleGroups.matches');
}
