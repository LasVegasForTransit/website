# Newsletter operations

How to publish, send, and maintain the LVBT newsletter on Ghost(Pro). For strategic framing, see [comms-strategy.md](../explanation/comms-strategy.md). For why we picked Ghost, see [decisions/newsletter-platform.md](../explanation/decisions/newsletter-platform.md).

> **Platform note.** The on-site subscribe form currently submits to **Beehiiv**, not Ghost — see [newsletter-signup.md](./newsletter-signup.md). This ops guide (and the decision record) still describe Ghost(Pro). Reconcile the platform choice; until then, treat the Ghost authoring/send workflow below as aspirational, and Beehiiv as the live signup system.

## Surface

- **Domain:** `journal.lasvegasfortransit.org` (Cloudflare CNAME → Ghost(Pro) alias domain)
- **Platform:** Ghost(Pro) Starter ($9/mo, 1 staff user, up to 500 members)
- **Sender domain:** `@lasvegasfortransit.org` — must be authenticated via SPF, DKIM, DMARC

## Authoring/send workflow

The agreed pattern is **hand-sent with RSS auto-import**: site content is canonical (MDX in repo); Ghost auto-creates a draft from the latest site post; the sender adds a 1–2 sentence framing intro and clicks send. Workflow per issue:

1. **Site post (if any) goes live** via the normal MDX-in-repo workflow. Verify it renders correctly on the live site.
2. **Ghost's RSS automation picks up the post** and creates a draft campaign in Ghost's admin.
3. **Open the draft.** Add a 1–2 sentence framing intro at the top — what we want the reader to take away from this issue. (This is what makes a newsletter feel human vs. robotic. Don't skip it.)
4. **Send a test** to your own inbox. Verify: rendering, all links, unsubscribe footer, mailing address footer.
5. **Send.**

Issues that don't tie to a site post (org-only updates, retrospectives, internal milestones) — compose directly in Ghost without an RSS import.

Cadence: monthly to bi-weekly. Don't send less than monthly (subscribers forget who you are). Don't send weekly until there's enough substance to fill weekly.

## Domain authentication (one-time setup)

**Required for deliverability.** Without these, emails go to spam regardless of content quality.

| Record | Type                                   | Notes                                                                                                                                                                       |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPF    | TXT on root or sender subdomain        | Ghost provides exact value (`v=spf1 include:_spf.ghost.io ~all` or similar)                                                                                                 |
| DKIM   | TXT (CNAME on Ghost(Pro))              | Ghost provides — add to Cloudflare DNS                                                                                                                                      |
| DMARC  | TXT on `_dmarc.lasvegasfortransit.org` | Start at `v=DMARC1; p=none; rua=mailto:dmarc@lasvegasfortransit.org` (monitor mode); tighten to `p=quarantine` once aggregate reports show clean alignment, then `p=reject` |

DMARC aggregate reports arrive weekly at the `rua=` mailbox. Configure that mailbox before going live or you'll lose the signal.

## CAN-SPAM compliance

US law requires the following in every commercial/advocacy email. Ghost handles most automatically; verify after any theme change.

- ✅ **Unsubscribe link** in every email (Ghost auto-includes; verify after theme tuning)
- ✅ **Sender identity** (Ghost auto-includes from publication settings)
- ⚠️ **Physical mailing address** — must be set in Ghost publication settings. Founder's address until LVBT secures a PO box or coworking-space mail handling.
- ✅ **Truthful subject lines** — editorial discipline, not a platform feature

## Subscriber data

- **Ownership:** LVBT owns the list. Ghost is a data processor under the publication's terms.
- **Export:** Ghost admin → Members → Export. CSV with email, name, subscription state, signup source, last-seen.
- **Unsubscribe and bounce handling:** Ghost auto-flags hard bounces and processes unsubscribes; no manual intervention.
- **Migration off Ghost(Pro):** see [decisions/newsletter-platform.md](../explanation/decisions/newsletter-platform.md) "Migration paths."

## Subscribe form on the main site

Native HTML form posting to Ghost's `/members/api/send-magic-link` endpoint (no third-party JS embed — fits the minimalist aesthetic, no extra runtime).

- **Component:** `src/components/SubscribeForm.astro` (when built — see v0 plan)
- **Footer slot:** every page on the site
- **Dedicated page:** `/subscribe`
- **Magic-link / double-opt-in:** handled by Ghost; site form just submits the email

The site's `/privacy` page must mention:

- What data is collected (email, optional name)
- Third-party processor: Ghost
- How to unsubscribe (link in every email + member account settings)

## Cost ladder

| Tier    | Monthly | Members | Staff seats | When                                        |
| ------- | ------- | ------- | ----------- | ------------------------------------------- |
| Starter | $9      | 500     | 1           | v0                                          |
| Creator | $25     | 1,000   | 2           | When 2nd contributor joins                  |
| Team    | $50     | 1,000   | 5           | When 3rd–5th contributor joins              |
| Custom  | Higher  | More    | More        | Probably never; revisit self-hosted instead |

When the next tier becomes warranted (subscriber count or staff seat), revisit whether Ghost(Pro) still wins vs. self-hosted Ghost — see [decisions/newsletter-platform.md](../explanation/decisions/newsletter-platform.md) "Trigger conditions."

## Pre-send checklist

Before clicking Send on any issue:

- [ ] Subject line: clear, specific, no clickbait
- [ ] Framing intro present (the human-voice paragraph at the top)
- [ ] All links open the right page (don't trust auto-imported links from RSS — Ghost sometimes mangles relative URLs)
- [ ] Images load (Ghost-hosted or R2-hosted; never from a private/dev URL or a temporary blob)
- [ ] Unsubscribe footer present
- [ ] Mailing address footer present
- [ ] Test sent to founder's inbox; checked on phone + desktop
- [ ] Test sent to a Gmail address (confirms not in Promotions tab)
- [ ] If linking to a site piece: site piece is published (not just on a preview deployment) and `noindex` is off

## Common failure modes

- **Email lands in Promotions / Spam:** check SPF, DKIM, DMARC alignment. New sender domains take 2–4 weeks to build reputation; expect some Promotions placement until then. Don't link-shorten — use full URLs. Don't include `https://bit.ly` etc.
- **Ghost RSS import drops formatting:** Ghost's importer doesn't handle every MDX component. For pieces with custom Astro components (callouts, embeds, scrollytelling fragments), write a stand-alone post in Ghost rather than relying on auto-import. Link back to the full piece on the site.
- **Subscribers report not getting issues:** check spam folder first, then verify the email isn't flagged in Ghost's Members admin (Ghost auto-flags hard bounces).
- **Theme update breaks layout in Outlook:** Outlook uses Word's HTML renderer, which is unforgiving (no flexbox, limited CSS). Test there before declaring a theme change done.
- **Custom domain stops resolving:** check Cloudflare DNS — Ghost(Pro) periodically rotates infrastructure and CNAME targets shift. If Ghost emails about a DNS update, do it; their grace period is short.

## Future / out of scope

- **Urgent / mobilization stream** (action alerts that don't need permanent posts): bias toward same Ghost list with a "rapid alerts" tag/segment, OR Bluesky/IG for time-sensitive blasts. Decide when needed.
- **Paid memberships / donations:** not a Ghost feature we use. Donations go through external Givebutter/Donorbox.
- **Newsletter analytics beyond Ghost defaults:** Ghost provides open/click rates. If we need deeper analytics, evaluate then; don't bolt on third-party tracking pixels (privacy-hostile, hurts deliverability).

## Related

- [Comms strategy](../explanation/comms-strategy.md) — strategic frame
- [Decision: newsletter platform](../explanation/decisions/newsletter-platform.md) — alternatives considered, why Ghost(Pro)
- [Decision: staff publishing](../explanation/decisions/staff-publishing.md) — how non-tech contributors edit site content (separate from newsletter authoring)
