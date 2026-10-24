/** Authentication policy is deployment configuration, never inferred from request headers. */
export interface StaffAuthConfig {
  LVBT_STAFF_AUTH_MODE?: string;
  LVBT_STAFF_ORIGIN?: string;
  LVBT_STAFF_PREVIEW_ORIGINS?: string;
  LVBT_GOOGLE_PREVIEW_ORIGINS?: string;
}
export function staffAuthMode(env: StaffAuthConfig): 'cloudflare-access' | 'google' | null {
  const mode = env.LVBT_STAFF_AUTH_MODE ?? 'cloudflare-access';
  return mode === 'cloudflare-access' || mode === 'google' ? mode : null;
}
function httpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function staffOriginAllowed(env: StaffAuthConfig, origin: string): boolean {
  if (!httpsOrigin(origin)) return false;
  const canonical = env.LVBT_STAFF_ORIGIN ?? 'https://staff.lasvegasfortransit.org';
  if (!httpsOrigin(canonical)) return false;
  if (origin === canonical) return true;
  if (
    env.LVBT_STAFF_ORIGIN === undefined &&
    origin === 'https://staff-preview.lasvegasfortransit.org'
  )
    return true;
  try {
    const previews: unknown = JSON.parse(env.LVBT_STAFF_PREVIEW_ORIGINS ?? '[]');
    if (Array.isArray(previews) && previews.includes(origin)) return true;
    const legacy: unknown = JSON.parse(env.LVBT_GOOGLE_PREVIEW_ORIGINS ?? '[]');
    return (
      Array.isArray(legacy) &&
      legacy.includes(origin) &&
      /^https:\/\/[a-z0-9-]*lvbt-staff-preview\.[a-z0-9-]+\.workers\.dev$/.test(origin)
    );
  } catch {
    return false;
  }
}
export function staffAuthBindings(env: StaffAuthConfig): string[] | null {
  const mode = staffAuthMode(env);
  if (!mode) return null;
  return [
    'LVBT_SIGN_IN_SECRET',
    'LVBT_RESEND_API_KEY',
    ...(mode === 'google'
      ? ['LVBT_GOOGLE_OAUTH_CLIENT_ID', 'LVBT_GOOGLE_OAUTH_CLIENT_SECRET']
      : ['LVBT_ACCESS_TEAM_DOMAIN', 'LVBT_ACCESS_AUD']),
  ];
}
