import type { EngagementEvent } from '@lasvegasfortransit/platform-storage/staff-history';
const LABELS: Record<string, string> = {
  note: 'Note',
  reason: 'Reason',
  method: 'Contact method',
  eventName: 'Event',
  location: 'Location',
  oldRole: 'Previous role',
  newRole: 'New role',
  endReason: 'Reason',
  amount: 'Amount',
  currency: 'Currency',
};
const FIELD_LABELS: Record<string, string> = {
  given_name: 'First name',
  family_name: 'Last name',
  email: 'Email',
  phone: 'Phone',
  zip: 'ZIP code',
  census_block: 'Census block',
  census_block_vintage: 'Census vintage',
  place_name: 'Place',
  preferred_language: 'Preferred language',
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
        value: `${item.before ?? 'Not recorded'} → ${item.after ?? 'Not recorded'}`,
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
