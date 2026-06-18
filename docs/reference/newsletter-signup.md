# Newsletter signup & verification

How the on-site subscribe form captures an email and how to configure it so a **verification ([double opt-in](./glossary.md#double-opt-in)) email** is actually sent. We force it so we only keep real, consenting addresses — which keeps our sender reputation healthy and bounce rates low.

> **Newsletter ≠ membership.** This inline box is the lighter, email-only path (homepage and `/go`). Becoming a _member_ goes through the Google Form — a separate flow that collects more and feeds Beehiiv + Notion. See [membership-intake.md](./membership-intake.md). Don't re-merge the two by dropping this box back onto `/join`.

> **Platform note.** This documents the _signup capture_ that ships in the site today, which submits to **Beehiiv** (the newsletter platform we currently send email through, via its API; see [glossary](./glossary.md#beehiiv)). The authoring/send workflow in [newsletter-ops.md](./newsletter-ops.md) and the [platform decision record](../explanation/decisions/newsletter-platform.md) describe **Ghost(Pro)** (a different hosted newsletter platform chosen for the long-form journal; see [glossary](./glossary.md#ghost)). Those are out of sync with the running code — reconcile the platform choice before relying on the Ghost docs.

## How it works

```
NewsletterEmbed.astro (form)
  → POST /api/subscribe            functions/api/subscribe.ts  (Cloudflare Pages Function)
    → POST https://api.beehiiv.com/v2/publications/{id}/subscriptions
```

- **Form:** `src/components/NewsletterEmbed.astro` — a native HTML form, no third-party embed.
- **Client wiring:** `public/scripts/newsletter-subscribe.js` — intercepts submit, POSTs JSON to `/api/subscribe`, shows the status message.
- **Server handler:** `functions/api/subscribe.ts` — validates the email and calls Beehiiv. The request body it sends:

  ```jsonc
  {
    "email": "…",
    "reactivate_existing": true,
    "send_welcome_email": true,
    "double_opt_override": "on", // forces the verification email
  }
  ```

`double_opt_override: "on"` (a Beehiiv field that forces the double opt-in flow per request, even if the publication's own toggle is off) is the load-bearing field. **Without it, Beehiiv creates API subscriptions as `active` immediately and sends no verification email at all.** With it, the subscriber is created as `validating` and Beehiiv emails a confirmation link; they become `active` only after clicking. The welcome email (`send_welcome_email`) follows confirmation.

## Required configuration

### 1. Secrets (Cloudflare Pages)

Set both as **Secrets** (Cloudflare's name for an encrypted env var whose value is hidden after you save it — used for API keys and passwords) in the Cloudflare Pages dashboard → project → Settings → Environment variables (Production **and** Preview). They are server-side only — never baked into the static HTML. Mirrored in `.env.local` for local dev (see [local-dev.md](./local-dev.md)).

| Key                           | Where to get it                                                           |
| ----------------------------- | ------------------------------------------------------------------------- |
| `LVBT_BEEHIIV_API_KEY`        | Beehiiv → Settings → API → create a key scoped to **Subscribers (write)** |
| `LVBT_BEEHIIV_PUBLICATION_ID` | Beehiiv → Settings → Publication → the ID starting with `pub_`            |

### 2. Beehiiv dashboard

`double_opt_override: "on"` forces the double opt-in flow regardless of the publication toggle, but Beehiiv still needs the pieces that make the email send and land:

- **Confirmation email** — Beehiiv → Settings → Subscribe flow / double opt-in. Confirm a confirmation email template exists and is enabled; brand it (logo, from-name, subject) so it doesn't look like spam.
- **Sender domain authentication (SPF / DKIM — DNS records that prove your email really comes from your domain so it lands in inboxes instead of spam; see [glossary](./glossary.md#email-auth))** — Beehiiv → Settings → sending domain. Until the sending domain is authenticated, verification emails go to spam or fail. This is the most common reason a subscriber "got nothing."
- **Welcome email (optional)** — `send_welcome_email: true` only does something if a Welcome Email automation is built and active in Beehiiv. It is _not_ the verification email; it sends after confirmation.

## Verifying it works

1. Subscribe with a real address on the live site (or `pnpm dev` locally with secrets set).
2. In Beehiiv → Subscribers (or via the API), the new subscriber should show status **`validating`**, not `active`. `validating` means the confirmation email was dispatched.
3. The confirmation email should arrive; clicking the link flips the subscriber to `active`.

API spot check with `curl` (a command-line tool for making HTTP requests; read-only here — it just lists recent subscribers and their status). Set `$PUB` to your publication ID and `$KEY` to your API key first:

```sh
curl -fsS "https://api.beehiiv.com/v2/publications/$PUB/subscriptions?limit=5&order_by=created&direction=desc" \
  -H "Authorization: Bearer $KEY"
```

## Troubleshooting

| Symptom                                            | Cause                                                                 | Fix                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| New subscribers show `active` and no email arrives | `double_opt_override` not sent (old deploy, or the field was removed) | Confirm `functions/api/subscribe.ts` sends `"double_opt_override": "on"` and the deploy is current |
| Status is `validating` but no email lands          | Sending domain not authenticated, or confirmation email disabled      | Authenticate SPF/DKIM in Beehiiv; enable + brand the confirmation email; check spam                |
| Form shows "Something went wrong"                  | Beehiiv API rejected the call                                         | Check Cloudflare Pages function logs — the handler logs the Beehiiv status + body on non-2xx       |
| Works in prod, not locally                         | Secrets missing from `.env.local`                                     | Add `LVBT_BEEHIIV_*`; `pnpm preflight` reports config state                                        |

## Related

- [Membership intake automation](./membership-intake.md) — Google Forms submissions that subscribe members and sync Notion
- [Newsletter operations](./newsletter-ops.md) — authoring/send workflow (currently Ghost-oriented; see platform note above)
- [Decision: newsletter platform](../explanation/decisions/newsletter-platform.md)
- [Local development](./local-dev.md) — env vars, dev server
