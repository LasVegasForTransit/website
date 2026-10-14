import type { PersonFields } from '@lasvegasfortransit/platform-storage/person-service';

export interface RosterImportProfile {
  givenName?: string | null;
  familyName?: string | null;
}

export function readRosterProfile(input: Record<string, unknown> | null): {
  fields: Pick<PersonFields, 'given_name' | 'family_name'>;
  valid: boolean;
} {
  const fields: Pick<PersonFields, 'given_name' | 'family_name'> = {};
  let valid = true;
  for (const [key, field] of [
    ['givenName', 'given_name'],
    ['familyName', 'family_name'],
  ] as const) {
    const value = input?.[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || value.trim().length > 100) {
      valid = false;
      continue;
    }
    const name = value.trim();
    if (name) fields[field] = name;
  }
  return { fields, valid };
}
