// Which sources may change which fields on a person. The person service
// applies this on every write; anything a source doesn't own is ignored with
// a warning, so, for example, Beehiiv can never overwrite a name a member
// typed on their account page. Documented in person-service.md.

import type { SqlValue } from './db';
import type { PersonFields, Source } from './person-service';

export type FieldName = keyof PersonFields;

const FIELD_OWNERS: Record<FieldName, readonly Source[]> = {
  given_name: ['join_form', 'google_form', 'external_form', 'member', 'staff', 'paper', 'import'],
  family_name: ['join_form', 'google_form', 'external_form', 'member', 'staff', 'paper', 'import'],
  email: [
    'join_form',
    'newsletter_box',
    'google_form',
    'external_form',
    'member',
    'staff',
    'import',
  ],
  phone: ['join_form', 'google_form', 'external_form', 'member', 'staff', 'paper', 'import'],
  zip: ['join_form', 'google_form', 'external_form', 'member', 'staff'],
  census_block: ['join_form', 'member', 'staff'],
  census_block_vintage: ['join_form', 'member', 'staff'],
  place_name: ['join_form', 'member', 'staff'],
  preferred_language: ['member', 'staff'],
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function ownedFields(
  source: Source,
  fields: PersonFields,
  warn: (message: string) => void,
): [FieldName, SqlValue][] {
  const allowed: [FieldName, SqlValue][] = [];
  for (const [name, value] of Object.entries(fields) as [FieldName, SqlValue | undefined][]) {
    if (value === undefined) continue;
    if (!FIELD_OWNERS[name].includes(source)) {
      warn(`person service: source ${source} may not change ${name}; ignored`);
      continue;
    }
    allowed.push([
      name,
      name === 'email' && typeof value === 'string' ? normalizeEmail(value) : value,
    ]);
  }
  return allowed;
}
