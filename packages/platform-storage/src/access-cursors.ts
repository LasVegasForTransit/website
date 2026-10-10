import { InvalidCursor } from './staff-history';
export function accessCursor(values: [string, string]): string {
  return btoa(JSON.stringify(values)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function readAccessCursor(value: string | undefined): [string, string] | null {
  if (!value) return null;
  try {
    if (value.length > 300 || !/^[\w-]+$/.test(value)) throw new InvalidCursor();
    const parsed: unknown = JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/')));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      parsed.some((item) => typeof item !== 'string' || item.length > 100)
    )
      throw new InvalidCursor();
    return parsed as [string, string];
  } catch {
    throw new InvalidCursor();
  }
}
