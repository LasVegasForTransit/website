# Membership Google Form as the source of truth for new members

**Date:** 2026-06-14 **Status:** Approved design, pending spec review

## Context

The site currently blurs two distinct flows:

- **Newsletter** — an inline email box (`NewsletterEmbed` → `/api/subscribe` → Beehiiv only),
  present on the homepage, `/go`, and `/join`.
- **Membership intake** — a Google Form → Apps Script → `/api/membership-intake` → Beehiiv + Notion
  pipeline (already built and hardened), which collects email, name, ZIP, and more. It is **not
  surfaced anywhere on the site**.

On `/join`, "Become a member" currently reads _"Add your email below and you're in"_ and renders the
inline newsletter box — so today, becoming a member is just a newsletter signup. We want the Google
Form to be the real, canonical front door for new members.

The form:

- Public link (canonical destination):
  `https://docs.google.com/forms/d/e/1FAIpQLSfE28qUHn9A_cYpEtz4OV9NvQLkhlVVwaMvho_fCS_SI34CwQ/viewform`
- Short link (used in config + QR): `https://forms.gle/mcLd4EQrGwRPA3bv7`

## Goal

Make the Google Form the membership entry point everywhere a visitor would "join," while keeping the
lighter newsletter signup as a separate, untouched path.

## Non-goals

- No change to the newsletter flow (`NewsletterEmbed`, `/api/subscribe`, the Beehiiv pipeline) on
  the homepage and `/go`.
- No native rebuild of the form on-site. The Google Form is the source of truth; we link out to it,
  we do not embed or reimplement it.
- No change to the membership-intake Pages Function or Apps Script — those already consume the form
  via its submit trigger, independent of how the site links to it.

## Design

### 1. Config (`src/lib/site.ts`, `.env.example`, `scripts/bootstrap/phases/env.ts`)

One new public env var, surfaced through the existing `urlFromEnv` hide-and-warn helper (no
hardcoded fallback literal in `site.ts`):

- `PUBLIC_LVBT_MEMBERSHIP_FORM_URL` = the `forms.gle` short link.

`site.ts` gains:

```ts
membership: {
  formUrl: urlFromEnv('PUBLIC_LVBT_MEMBERSHIP_FORM_URL'),
},
```

The short link is used by **both** the `/join` button and the QR slide: it works as a normal browser
link and fits the QR encoder's 84-byte cap (35 bytes). The long `viewform` URL is recorded here in
the spec and in `membership-intake.md` as the canonical destination, but does not need to live in
config.

- `.env.example`: add `PUBLIC_LVBT_MEMBERSHIP_FORM_URL=https://forms.gle/mcLd4EQrGwRPA3bv7` under a
  "Membership form" comment (prefilled like the social URLs — it is public and baked into the static
  HTML at build).
- `bootstrap/phases/env.ts`: add the key to `PROMPTED_KEYS` (a `PUBLIC_` var, with a hint pointing
  at the Google Forms Send → Shorten URL dialog) so it appears in the config status table and can be
  re-entered if blanked.

### 2. `/join` page (`src/pages/join.astro`)

- Remove the `NewsletterEmbed` import and its use in the "Become a member" section.
- Rework the section copy. The first line changes from _"Add your email below and you're in"_ to
  point at the form; the existing second paragraph (newsletter updates + strength-in-numbers) is
  kept, lightly adjusted so it no longer implies an inline email box. Final copy to be confirmed
  during review; proposed:
  > Membership is free and takes a minute. Fill out the membership form and you're on the rolls.
  >
  > You'll get our newsletter — the easiest way to keep up with the 2028 service cuts, the 2027
  > legislative session, and the times we need people to show up. And the more members we have, the
  > more weight we carry: when we meet with officials, the number of people behind us is part of the
  > argument.
- Add a prominent **"Become a member →"** button/link to `site.membership.formUrl`, with
  `target="_blank"` and `rel="noopener"`, styled to match the page's existing CTA treatment.
- **Missing-config behavior:** if `formUrl` is unset, `urlFromEnv` already warns at build. The
  section then renders the existing general-interest email path (`generalInterestMailto()`, already
  imported on the page) as the fallback instead of a dead button — `/join` never ships a broken
  primary CTA.

### 3. QR deck (`src/pages/qr.astro`)

- Add a membership slide, conditional on `site.membership.formUrl` (same optional-slide pattern as
  the social slides), inserted **immediately after** the website slide so the website stays slide
  index 0:

  ```ts
  site.membership.formUrl && {
    id: 'join',
    label: 'Join',
    title: 'Become a member',
    url: site.membership.formUrl,
    hint: 'Scan to fill out the membership form.',
  };
  ```

- The existing 84-byte guard in `qrSvg` (`src/lib/qr-svg.ts`) protects the build against an
  over-long value; the `forms.gle` link is 35 bytes.

### 4. Docs

- `docs/reference/membership-intake.md`: note that the public form URL is configured via
  `PUBLIC_LVBT_MEMBERSHIP_FORM_URL` (the `forms.gle` short link), surfaced as the `/join` CTA and
  the QR "Join" slide, and resolves to the canonical `viewform` URL above.
- `docs/reference/newsletter-signup.md`: one line distinguishing the newsletter (inline Beehiiv box)
  from membership (the Google Form), so the two are not re-merged later.

### 5. Tests

- `tests/body-links.spec.ts`: the website remains QR slide 0 (existing assertion holds). Add an
  assertion that the "Join" slide renders with the configured form URL when set.
- Confirm no test asserts `NewsletterEmbed` is present on `/join`; update any that does.
- Regenerate `/join` accessibility/visual snapshots if the button-vs-box change shifts them.

## Verification

1. `pnpm dev`, open `/join`: the "Become a member" button links to the `forms.gle` URL and opens the
   form in a new tab; the inline email box is gone.
2. Open `/qr`: a "Join" slide appears right after the website slide, its QR resolves to the form,
   and the build did not throw on the encoder cap.
3. Temporarily blank `PUBLIC_LVBT_MEMBERSHIP_FORM_URL`: build warns, `/join` falls back to the email
   path, and the QR "Join" slide is omitted — no broken link, no build failure.
4. `pnpm test` (Playwright) and `pnpm typecheck` pass; homepage and `/go` newsletter boxes are
   unchanged.

## Open questions

None. (Single env var holding the `forms.gle` short link, confirmed with the user.)
