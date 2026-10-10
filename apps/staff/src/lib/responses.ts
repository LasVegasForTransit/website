export function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  // Native POST forms need their same-origin Origin header; external requests get no referrer.
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; script-src 'none'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
export function messageResponse(message: string, status: number) {
  return privateResponse(
    new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
  );
}
