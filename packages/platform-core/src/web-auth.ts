export const SITE_ORIGIN = 'https://lasvegasfortransit.org';
export const SESSION_COOKIE = '__Host-lvbt_session';
export const SIGNED_IN_COOKIE = 'lvbt_signed_in';
export const ACCOUNT_PATH = '/account/';
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

/** The session cookie and the non-secret "signed in" marker for public pages. */
export function sessionCookies(token: string, expiresAt: Date): string[] {
  const expires = expiresAt.toUTCString();
  return [
    `${SESSION_COOKIE}=${token}; Expires=${expires}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    `${SIGNED_IN_COOKIE}=1; Expires=${expires}; Path=/; Secure; SameSite=Lax`,
  ];
}

export function clearedSessionCookies(): string[] {
  return [
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
    `${SIGNED_IN_COOKIE}=; Max-Age=0; Path=/; Secure; SameSite=Lax`,
  ];
}

export function safeNext(next: string | null | undefined): string {
  if (!next?.startsWith('/') || next.startsWith('//') || next.includes('\\')) return ACCOUNT_PATH;
  try {
    const url = new URL(next, SITE_ORIGIN);
    if (url.origin !== SITE_ORIGIN) return ACCOUNT_PATH;
    return `${url.pathname}${url.search}`;
  } catch {
    return ACCOUNT_PATH;
  }
}
