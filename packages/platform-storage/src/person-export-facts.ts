import { WELCOME_METHODS } from '@lasvegasfortransit/platform-core/welcome';

type Fact = string | number | boolean | null;
type Reader = (value: unknown) => Fact | undefined;
const choice =
  (values: readonly string[]): Reader =>
  (value) =>
    typeof value === 'string' && values.includes(value) ? value : undefined;
const nullable =
  (read: Reader): Reader =>
  (value) =>
    value === null ? null : read(value);
const number: Reader = (value) => {
  const numeric =
    typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
  return typeof numeric === 'number' &&
    Number.isFinite(numeric) &&
    numeric >= 0 &&
    numeric <= Number.MAX_SAFE_INTEGER
    ? numeric
    : undefined;
};
const boolean: Reader = (value) => (typeof value === 'boolean' ? value : undefined);
const label: Reader = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) return undefined;
  // A human event or shift label must not become a channel for account IDs or contacts.
  if (
    /\p{Cc}/u.test(value) ||
    /\S+@\S+|https?:\/\/|\b[0-9A-HJKMNP-TV-Z]{26}\b|\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b|\b\d{16,}\b|\b(?:sub_|pub_|evt_|merge[-_:])/i.test(
      value,
    )
  )
    return undefined;
  return value;
};
const date: Reader = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
};
const time: Reader = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value
    : undefined;
const EVENT_FACTS = {
  eventName: label,
  location: label,
  eventDate: date,
  datePrecision: choice(['day', 'minute', 'second']),
};
const CONTACT_FACTS = { method: choice(WELCOME_METHODS) };
const SCHEMAS: Record<string, Record<string, Reader>> = {
  donated: {
    amount: number,
    currency: (value) =>
      typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : undefined,
  },
  attended: { ...EVENT_FACTS, newsletterConsent: boolean },
  rsvp: {
    ...EVENT_FACTS,
    response: choice([
      'going',
      'not_going',
      'maybe',
      'waitlisted',
      'yes',
      'no',
      'accepted',
      'declined',
      'tentative',
    ]),
    status: choice([
      'going',
      'not_going',
      'maybe',
      'waitlisted',
      'yes',
      'no',
      'accepted',
      'declined',
      'tentative',
    ]),
  },
  volunteer_shift: {
    ...EVENT_FACTS,
    shiftName: label,
    startedAt: time,
    endedAt: time,
    durationMinutes: number,
    hours: number,
  },
  welcomed: CONTACT_FACTS,
  check_in_held: CONTACT_FACTS,
  role_changed: {
    oldRole: nullable(choice(['member', 'lead'])),
    newRole: nullable(choice(['member', 'lead'])),
    endReason: nullable(choice(['stepped_back', 'moved', 'left_lvbt', 'removed'])),
  },
};

/** Export only recognized facts about this person's own event; never notes or identifiers. */
export function personalActivityFacts(
  type: string,
  details: Record<string, unknown>,
): Record<string, Fact> {
  const facts: Record<string, Fact> = {};
  for (const [field, read] of Object.entries(SCHEMAS[type] ?? {})) {
    const value = read(details[field]);
    if (value !== undefined) facts[field] = value;
  }
  return facts;
}
