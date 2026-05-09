/// <reference types="@cloudflare/workers-types" />

// Dev: pnpm dev (wrangler pages dev proxies /api/* through this function)
// LVBT_BEEHIIV_API_KEY and LVBT_BEEHIIV_PUBLICATION_ID must be set as
// Secrets in Cloudflare Pages dashboard (Settings → Environment Variables).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Env {
  LVBT_BEEHIIV_API_KEY: string;
  LVBT_BEEHIIV_PUBLICATION_ID: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://lasvegasfortransit.org",
  };

  let body: { email?: string; name?: string };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400, headers });
  }

  const email = (body.email ?? "").trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "invalid_email" }, { status: 400, headers });
  }

  const { LVBT_BEEHIIV_API_KEY, LVBT_BEEHIIV_PUBLICATION_ID } = context.env;
  const url = `https://api.beehiiv.com/v2/publications/${LVBT_BEEHIIV_PUBLICATION_ID}/subscriptions`;

  const beehiivRes = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LVBT_BEEHIIV_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      reactivate_existing: true,
      send_welcome_email: true,
    }),
  });

  if (!beehiivRes.ok) {
    console.error("Beehiiv API error", beehiivRes.status, await beehiivRes.text());
    return Response.json({ error: "subscription_failed" }, { status: 502, headers });
  }

  return Response.json({ success: true }, { status: 200, headers });
};
