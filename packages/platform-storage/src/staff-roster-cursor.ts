import type { Person } from './person-service';
import { InvalidCursor, validatePersonCursor } from './staff-history';

export const ROSTER_NAME = `coalesce(nullif(trim(coalesce(p.given_name,'') || ' ' || coalesce(p.family_name,'')),''),nullif(p.email,''),'Name not recorded') COLLATE NOCASE`;

export function rosterCursor(person: Person): string {
  let name = [person.given_name, person.family_name].filter(Boolean).join(' ').trim();
  if (!name) name = person.email ?? '';
  if (!name) name = 'Name not recorded';
  const bytes = new TextEncoder().encode(JSON.stringify([name, person.id]));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function readRosterCursor(cursor?: string): [string, string] | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 2048 || !/^[\w-]+$/.test(cursor)) throw new InvalidCursor();
    const binary = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== 'string' ||
      value[0].length > 300 ||
      typeof value[1] !== 'string' ||
      !value[1]
    )
      throw new InvalidCursor();
    validatePersonCursor(value[1]);
    return [value[0], value[1]];
  } catch {
    throw new InvalidCursor();
  }
}
