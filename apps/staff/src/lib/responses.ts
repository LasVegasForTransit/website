import { messagePage, messagePageStyleHash } from './message-page';
export function privateResponse(response: Response, path = ''): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  // Native POST forms need their same-origin Origin header; external requests get no referrer.
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  const scripts = path === '/paper/' ? "'self'" : "'none'";
  headers.set(
    'Content-Security-Policy',
    `default-src 'none'; style-src 'self' 'sha256-${messagePageStyleHash}'; font-src 'self' data:; img-src 'self'; script-src ${scripts}; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
export function messageResponse(
  message: string,
  status: number,
  destination: 'home' | 'welcome' = 'home',
) {
  return privateResponse(
    new Response(messagePage(message, status, destination), {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
  );
}
