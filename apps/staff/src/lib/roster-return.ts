/** Keep member work connected to the roster the staff member started from. */
export function rosterReturn(value: string | null): string | null {
  if (!value || value.length > 4096 || !value.startsWith('/people/')) return null;
  const url = new URL(value, 'https://staff.lasvegasfortransit.org');
  if (url.origin !== 'https://staff.lasvegasfortransit.org' || url.pathname !== '/people/')
    return null;
  const query = new URLSearchParams();
  for (const key of ['q', 'email', 'status', 'committee', 'zip', 'cursor']) {
    const parameter = url.searchParams.get(key);
    if (parameter) query.set(key, parameter);
  }
  return `/people/${query.size ? `?${query.toString()}` : ''}`;
}
