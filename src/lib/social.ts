// Derive the public @handle from a social profile URL so the displayed handle
// always matches the env-configured link instead of being hardcoded next to it.
// Returns undefined for unset or unparseable URLs so callers can skip rendering.
export function handleFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const segments = new URL(url).pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const last = segments.at(-1);
    return last ? `@${last}` : undefined;
  } catch {
    return undefined;
  }
}
