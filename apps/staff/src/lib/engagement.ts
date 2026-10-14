import { t } from '@lasvegasfortransit/platform-core/messages';
import type { EngagementEvent } from '@lasvegasfortransit/platform-storage/staff-history';
const LABELS: Record<string, string> = {
  note: t('staff.record.note'),
  reason: t('staff.record.reason'),
  method: t('staff.record.method'),
  eventName: t('staff.record.event'),
  location: t('staff.record.location'),
  oldRole: t('staff.record.previousRole'),
  newRole: t('staff.record.newRole'),
  endReason: t('staff.record.reason'),
  amount: t('staff.record.amount'),
  currency: t('staff.record.currency'),
};
const FIELD_LABELS: Record<string, string> = {
  given_name: t('staff.labels.given_name'),
  family_name: t('staff.labels.family_name'),
  email: t('staff.common.email'),
  phone: t('staff.common.phone'),
  zip: t('staff.common.zip'),
  census_block: t('staff.record.censusBlock'),
  census_block_vintage: t('staff.record.censusVintage'),
  place_name: t('staff.record.place'),
  preferred_language: t('staff.profile.language'),
};
function correctionFacts(changes: unknown): { label: string; value: string }[] {
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change: unknown) => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) return [];
    const item = change as Record<string, unknown>;
    if (typeof item.field !== 'string' || !Object.hasOwn(FIELD_LABELS, item.field)) return [];
    if (
      (item.before !== null && typeof item.before !== 'string') ||
      (item.after !== null && typeof item.after !== 'string')
    )
      return [];
    return [
      {
        label: FIELD_LABELS[item.field],
        value: `${item.before ?? t('staff.common.notRecorded')} → ${item.after ?? t('staff.common.notRecorded')}`,
      },
    ];
  });
}
export function eventFacts(event: EngagementEvent): { label: string; value: string }[] {
  if (!event.details) return [];
  const details: unknown = JSON.parse(event.details);
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  return Object.entries(details).flatMap(([key, value]) => {
    if (key === 'changes') return correctionFacts(value);
    if (!Object.hasOwn(LABELS, key) || (typeof value !== 'string' && typeof value !== 'number'))
      return [];
    const formatted = ['method', 'oldRole', 'newRole', 'endReason'].includes(key)
      ? String(value).replaceAll('_', ' ')
      : String(value);
    return [{ label: LABELS[key], value: formatted }];
  });
}
