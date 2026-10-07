/// <reference types="@cloudflare/workers-types" />

export const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com; frame-src 'self'; connect-src 'self' https://cloudflareinsights.com https://events.lasvegasfortransit.org; form-action 'self' https://givebutter.com; object-src 'none'; upgrade-insecure-requests",
};

export async function builtPage(
  env: { ASSETS: Fetcher },
  request: Request,
  path: string,
): Promise<Response> {
  let url = new URL(path, request.url);
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
    const location = response.headers.get('Location');
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    return response;
  }
  throw new Error(`site page: too many redirects fetching ${path}`);
}

export function finishPage(
  response: Response,
  status: number,
  extraHeaders: HeadersInit = {},
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.set('Cache-Control', 'no-store');
  headers.delete('ETag');
  headers.delete('Content-Length');
  for (const [name, value] of new Headers(extraHeaders)) headers.append(name, value);
  return new Response(response.body, { status, headers });
}
