import { t } from './messages';
import { normalizePhone } from './join-form';
export const PAPER_WORDING_VERSION = 'paper-v1';
export const LEGACY_PAPER_WORDING_VERSION = 'paper-signup-v1';
// Fixed evidence text: changing it requires a new wording version.
export const PAPER_CONSENT_TEXT = t('staff.paper.wordingOriginal');
export const MAX_PAPER_ROWS = 12;
export interface PaperRow {
  givenName: string;
  familyName: string;
  email: string;
  phone: string;
  newsletterConsent: boolean;
}
export interface PaperInput {
  batchId: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  wordingVersion: string;
  rows: PaperRow[];
}
export type PaperErrors = Record<string, string>;
export function emptyPaperRow(): PaperRow {
  return { givenName: '', familyName: '', email: '', phone: '', newsletterConsent: false };
}
export function blankPaperRow(row: PaperRow): boolean {
  return (
    !row.givenName.trim() &&
    !row.familyName.trim() &&
    !row.email.trim() &&
    !row.phone.trim() &&
    !row.newsletterConsent
  );
}
function rowErrors(row: PaperRow, index: number, errors: PaperErrors) {
  const prefix = `rows.${index}.`;
  for (const [name, limit] of [
    ['givenName', 128],
    ['familyName', 128],
    ['email', 254],
    ['phone', 50],
  ] as const) {
    if (typeof row[name] !== 'string' || row[name].length > limit || /\p{Cc}/u.test(row[name]))
      errors[prefix + name] = t('staff.paper.entryError');
  }
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim()))
    errors[prefix + 'email'] = t('staff.paper.emailError');
  if (row.phone && !normalizePhone(row.phone))
    errors[prefix + 'phone'] = t('staff.paper.phoneError');
  if (row.newsletterConsent && !row.email.trim())
    errors[prefix + 'email'] = t('staff.paper.signupEmailError');
  if (typeof row.newsletterConsent !== 'boolean')
    errors[prefix + 'newsletterConsent'] = t('staff.paper.signupError');
}
export function paperToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function paperDayStarts(day: string): string {
  const desired = new Date(`${day}T00:00:00.000Z`).getTime();
  let candidate = desired;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = formatter.formatToParts(new Date(candidate));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const local = new Date(0);
    local.setUTCFullYear(value('year'), value('month') - 1, value('day'));
    local.setUTCHours(value('hour'), value('minute'), value('second'), 0);
    candidate = desired - (local.getTime() - candidate);
  }
  return new Date(candidate).toISOString();
}
function sheetDateError(value: string, now: Date): string | null {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return t('staff.paper.dateError');
  return value > paperToday(now) ? t('staff.paper.futureError') : null;
}
export function validatePaper(input: PaperInput, now: Date = new Date()): PaperErrors {
  const errors: PaperErrors = {};
  if (!/^[\w:-]{1,100}$/.test(input.batchId)) errors.batchId = t('staff.paper.reloadError');
  if (!input.eventId.trim() || input.eventId.length > 512 || /\p{Cc}/u.test(input.eventId))
    errors.eventId = t('staff.paper.publicEventError');
  if (!input.eventName.trim() || input.eventName.length > 160 || /\p{Cc}/u.test(input.eventName))
    errors.eventName = t('staff.paper.eventError');
  const dateError = sheetDateError(input.eventDate, now);
  if (dateError) errors.eventDate = dateError;
  if (![PAPER_WORDING_VERSION, LEGACY_PAPER_WORDING_VERSION].includes(input.wordingVersion))
    errors.wordingVersion = t('staff.paper.wordingError');
  if (!input.rows.length || input.rows.length > MAX_PAPER_ROWS)
    errors.rows = t('staff.paper.rowsError');
  const emails = new Set<string>();
  input.rows.forEach((row, index) => {
    rowErrors(row, index, errors);
    const email = row.email.trim().toLowerCase();
    if (email && emails.has(email))
      errors[`rows.${index}.email`] = t('staff.paper.duplicateEmailError');
    if (email) emails.add(email);
  });
  if (input.rows.every(blankPaperRow)) errors.rows = t('staff.paper.emptyError');
  return errors;
}
