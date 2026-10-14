import { InvalidCursor } from './staff-history';
export function readGoogleGroupCursor(value: string | undefined): [string, string] | null {
  if (!value) return null;
  try {
    if (value.length > 1024 || !/^[\w-]+$/.test(value)) throw new InvalidCursor();
    const parsed: unknown = JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/')));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      parsed.some((part) => typeof part !== 'string' || part.length > 254)
    )
      throw new InvalidCursor();
    return parsed as [string, string];
  } catch {
    throw new InvalidCursor();
  }
}
