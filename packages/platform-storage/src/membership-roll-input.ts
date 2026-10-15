export interface CurrentMembershipObservation {
  personId: string;
  externalId: string;
  status: 'active' | 'inactive' | 'pending' | 'unknown';
  observedAt: string;
  sourceCreatedAt?: string | null;
  withdrawnAt?: string | null;
}
const PRECISE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
function validTime(value: unknown): value is string {
  if (typeof value !== 'string' || !PRECISE.test(value) || !Number.isFinite(Date.parse(value)))
    return false;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year ?? 0, (month ?? 0) - 1, day);
  calendar.setUTCHours(hour ?? 0, minute ?? 0, second ?? 0, 0);
  return (
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() + 1 === month &&
    calendar.getUTCDate() === day &&
    calendar.getUTCHours() === hour &&
    calendar.getUTCMinutes() === minute &&
    calendar.getUTCSeconds() === second
  );
}
function validId(value: unknown) {
  return (
    typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200
  );
}
function optionalTimes(input: CurrentMembershipObservation) {
  const source = input.sourceCreatedAt,
    withdrawn = input.withdrawnAt;
  if (source != null && (!validTime(source) || Date.parse(source) > Date.parse(input.observedAt)))
    return false;
  if (withdrawn == null) return true;
  return (
    input.status === 'inactive' &&
    validTime(withdrawn) &&
    Date.parse(withdrawn) <= Date.parse(input.observedAt) &&
    (source == null || Date.parse(withdrawn) >= Date.parse(source))
  );
}
export function validObservation(input: CurrentMembershipObservation) {
  return (
    validId(input.personId) &&
    validId(input.externalId) &&
    ['active', 'inactive', 'pending', 'unknown'].includes(input.status) &&
    validTime(input.observedAt) &&
    Date.parse(input.observedAt) <= Date.now() &&
    optionalTimes(input)
  );
}
