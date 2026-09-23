// Reading and checking a join submission. Pure: no network, no storage. The
// same rules serve the join form and the newsletter box.

export const INTERESTS = ['events', 'meetings', 'volunteering', 'news'] as const;
export type Interest = (typeof INTERESTS)[number];

export type JoinOrigin = 'join_form' | 'newsletter_box';

export const CONSENT_WORDING: Record<JoinOrigin, string> = {
  join_form: 'join-form-v1',
  newsletter_box: 'newsletter-box-v1',
};

export interface JoinInput {
  origin: JoinOrigin;
  email: string;
  givenName: string;
  familyName: string;
  zip: string;
  phone: string;
  /** Held in memory for one geocoding call, then dropped. Never stored. */
  address: string;
  interests: Interest[];
  consent: boolean;
  /** One-time token from the form, used to make a double submit harmless. */
  formToken: string;
  /** Hidden field bots fill in and people never see. */
  honeypot: string;
}

export type JoinField = 'email' | 'zip' | 'phone' | 'consent';
export type JoinErrors = Partial<Record<JoinField, 'invalid' | 'required'>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LENGTH = 200;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim().slice(0, MAX_LENGTH) : '';
}

export function readJoinForm(form: FormData): JoinInput {
  const origin = text(form, 'origin') === 'newsletter_box' ? 'newsletter_box' : 'join_form';
  const interests = form
    .getAll('interests')
    .filter((value): value is Interest => INTERESTS.includes(value as Interest));
  return {
    origin,
    email: text(form, 'email').toLowerCase(),
    givenName: text(form, 'given_name'),
    familyName: text(form, 'family_name'),
    zip: text(form, 'zip'),
    phone: text(form, 'phone'),
    address: text(form, 'address'),
    interests: [...new Set(interests)],
    consent: form.get('consent') === 'yes',
    formToken: text(form, 'form_token'),
    honeypot: text(form, 'website'),
  };
}

/**
 * A US phone number in E.164 form (+17025550123), or null when it can't be
 * read as one. Only US numbers are accepted for now.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replaceAll(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** A stored US phone number as people write it: (702) 555-0123. */
export function formatPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

export function validateJoin(input: JoinInput): JoinErrors {
  const errors: JoinErrors = {};
  if (!EMAIL_PATTERN.test(input.email)) errors.email = input.email ? 'invalid' : 'required';
  if (input.zip && !/^\d{5}$/.test(input.zip)) errors.zip = 'invalid';
  if (input.phone && normalizePhone(input.phone) === null) errors.phone = 'invalid';
  if (!input.consent) errors.consent = 'required';
  return errors;
}

export function hasErrors(errors: JoinErrors): boolean {
  return Object.keys(errors).length > 0;
}
