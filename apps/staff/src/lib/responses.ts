import { messagePage, messagePageStyleHash, type StaffErrorReport } from './message-page';
export function createStaffErrorReport(): StaffErrorReport {
  const reference = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  return {
    reference: `${reference.slice(0, 4)}-${reference.slice(4, 8)}-${reference.slice(8)}`,
    occurredAt: new Date().toISOString(),
  };
}

export function readStaffErrorReport(response: Response): StaffErrorReport | undefined {
  const reference = response.headers.get('X-LVBT-Error-Reference');
  const occurredAt = response.headers.get('X-LVBT-Error-Time');
  if (
    !reference ||
    !/^[A-F0-9]{4}(?:-[A-F0-9]{4}){2}$/.test(reference) ||
    !occurredAt ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(occurredAt)
  )
    return undefined;
  const date = new Date(occurredAt);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== occurredAt) return undefined;
  return { reference, occurredAt };
}

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
  report?: StaffErrorReport,
) {
  const details = status >= 500 ? (report ?? createStaffErrorReport()) : undefined;
  if (details && !report)
    console.error({
      event: 'staff_request_failed',
      layer: 'response',
      category: 'http_error',
      status,
      requestId: details.reference,
      occurredAt: details.occurredAt,
    });
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  if (details) {
    headers.set('X-LVBT-Error-Reference', details.reference);
    headers.set('X-LVBT-Error-Time', details.occurredAt);
  }
  return privateResponse(
    new Response(messagePage(message, status, destination, details), {
      status,
      headers,
    }),
  );
}
