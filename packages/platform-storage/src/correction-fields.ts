import { normalizePhone } from '@lasvegasfortransit/platform-core/join-form';
import { ownedFields, normalizeEmail, type FieldName } from './field-ownership';
import type { Person, PersonFields } from './person-service';
import type { SqlValue } from './db';
const LIMITS: Record<FieldName, number> = {
  given_name: 128,
  family_name: 128,
  email: 254,
  phone: 50,
  zip: 5,
  census_block: 15,
  census_block_vintage: 20,
  place_name: 200,
  preferred_language: 35,
};
const PATTERNS: Partial<Record<FieldName, RegExp>> = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  zip: /^\d{5}$/,
  census_block: /^\d{15}$/,
  preferred_language: /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/,
};
function normalizedValue(field: FieldName, value: unknown): string | null | false {
  if (value !== null && typeof value !== 'string') return false;
  const trimmed = value?.trim() ?? null;
  const text = trimmed === '' ? null : trimmed;
  if (text === null) return field === 'preferred_language' ? false : null;
  if (text.length > LIMITS[field] || /\p{Cc}/u.test(text)) return false;
  if (PATTERNS[field] && !PATTERNS[field].test(text)) return false;
  if (field === 'phone') return normalizePhone(text) ?? false;
  return field === 'email' ? normalizeEmail(text) : text;
}
export function correctionFields(fields: unknown): [FieldName, SqlValue][] | null {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const normalized: PersonFields = {};
  for (const [key, value] of Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))) {
    if (!Object.hasOwn(LIMITS, key)) return null;
    const field = key as FieldName;
    const next = normalizedValue(field, value);
    if (next === false) return null;
    Object.assign(normalized, { [field]: next });
  }
  return ownedFields('staff', normalized, () => undefined);
}
export function changedCorrectionFields(person: Person, entries: [FieldName, SqlValue][]) {
  const changed = entries.filter(([field, value]) => person[field] !== value);
  if (changed.some(([field]) => field === 'zip')) {
    for (const field of ['census_block', 'census_block_vintage', 'place_name'] as const) {
      if (!entries.some(([name]) => name === field) && person[field] !== null)
        changed.push([field, null]);
    }
  }
  return changed;
}
