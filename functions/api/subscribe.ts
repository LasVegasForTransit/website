/// <reference types="@cloudflare/workers-types" />

// Dev: pnpm dev (wrangler pages dev proxies /api/* through this function)
// LVBT_BEEHIIV_API_KEY and LVBT_BEEHIIV_PUBLICATION_ID must be set as
// Secrets in Cloudflare Pages dashboard (Settings → Environment Variables).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Env {
  LVBT_BEEHIIV_API_KEY: string;
  LVBT_BEEHIIV_PUBLICATION_ID: string;
}

interface SubscribeBody {
  email?: string;
  name?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://lasvegasfortransit.org',
  };

  // Fail fast (and visibly in Cloudflare Pages logs) if either Beehiiv
  // secret is missing from this environment. Distinct from a Beehiiv API
  // failure so a curl-based smoke test can tell config drift apart from
  // an upstream outage.
  const { LVBT_BEEHIIV_API_KEY, LVBT_BEEHIIV_PUBLICATION_ID } = context.env;
  if (!LVBT_BEEHIIV_API_KEY || !LVBT_BEEHIIV_PUBLICATION_ID) {
    const missing = [
      !LVBT_BEEHIIV_API_KEY && 'LVBT_BEEHIIV_API_KEY',
      !LVBT_BEEHIIV_PUBLICATION_ID && 'LVBT_BEEHIIV_PUBLICATION_ID',
    ]
      .filter(Boolean)
      .join(', ');
    console.error(`/api/subscribe: missing required Pages secret(s): ${missing}`);
    return Response.json({ error: 'service_unavailable' }, { status: 503, headers });
  }

  let body: SubscribeBody;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400, headers });
  }

  const email = (body.email ?? '').trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: 'invalid_email' }, { status: 400, headers });
  }

  const url = `https://api.beehiiv.com/v2/publications/${LVBT_BEEHIIV_PUBLICATION_ID}/subscriptions`;

  const beehiivRes = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LVBT_BEEHIIV_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      reactivate_existing: true,
      send_welcome_email: true,
    }),
  });

  if (!beehiivRes.ok) {
    console.error('Beehiiv API error', beehiivRes.status, await beehiivRes.text());
    return Response.json({ error: 'subscription_failed' }, { status: 502, headers });
  }

  // Workers runtime holds the TCP connection open until the body is consumed
  // or cancelled; abandoning it silently exhausts the connection pool.
  await beehiivRes.body?.cancel();

  return Response.json({ success: true }, { status: 200, headers });
};
