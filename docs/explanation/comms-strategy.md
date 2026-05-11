# Comms strategy

What LVBT publishes, where it lives, and why each surface exists. Read before adding a new content type or proposing a platform change.

## The hybrid surface model

The website is not a publication. The newsletter is not on the website. Each surface does one job.

| Surface                                       | Role                                                                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lasvegasfortransit.org`                      | Reference + tools + data + journalism. Project pages, About, fact sheets, glossary, scrollytelling explainers, interactive tools, public data dashboard. |
| `journal.lasvegasfortransit.org` (Ghost(Pro)) | Serial newsletter — long-form analysis, monthly/bi-weekly org updates.                                                                                   |
| Instagram + Bluesky                           | Daily/weekly visual storytelling. Drives traffic to site pieces and newsletter signups.                                                                  |
| Earned / press                                | Site analyses become journalist ammunition. LVBT becomes a citation source.                                                                              |

**Comms loop:** Site release (scrollytelling piece, tool launch, data update) → newsletter dispatches it with framing → social drives traffic → readers convert to subscribers → repeat.

## Audiences

The newsletter and site serve different priority audiences with different needs. Order matters when making editorial choices.

1. **Engaged supporters** — already know LVBT, want depth. Newsletter is the primary surface for them. Tone: direct, substantive, treats them as insiders.
2. **Curious newcomers** — Google "Las Vegas transit" or "RTC budget cuts" and find LVBT. Site is their entry point; we want them to convert to newsletter subscribers. Tone: explanatory but never condescending.
3. **Decision-makers / journalists** — looking for citable analysis. Site is what they bookmark and quote. SEO and URL permanence on our own domain are load-bearing. Tone: rigorous, sourced, quotable.
4. **Cross-movement allies** — adjacent civic orgs, transit advocates in other cities. Site's open-source movement infrastructure is for them (long-term). Tone: peer-to-peer, generous with what we've learned.

## Ladder of engagement

Stranger → reader (one site visit) → returning reader → newsletter subscriber → donor → volunteer → activist showing up at RTC meetings. Each platform serves different transitions:

- **Social (IG/Bluesky):** stranger → reader.
- **Site:** reader → returning reader → subscriber.
- **Newsletter:** subscriber → donor → volunteer.
- **In-person events:** volunteer → activist.

Don't expect any single surface to do all of it. Editorial choices for each surface should reflect which transitions it's responsible for.

## Distribution / discovery

Where new readers come from, in priority order:

1. **SEO** — Google searches for transit topics specific to Vegas. Most leveraged by canonical content on `lasvegasfortransit.org` (project pages, scrollytelling explainers, fact sheets). Cuts against publishing on third-party platforms (Substack, Beehiiv) that fragment our domain authority.
2. **Press / earned media** — journalists citing LVBT analyses. Same canonical-on-our-domain incentive applies — reporters link to a stable, branded URL.
3. **Cross-promotion with adjacent civic orgs** — local, plays well at any scale.
4. **Direct sharing** — supporters forwarding the newsletter or sharing site pieces. Each surface optimized for shareability (clean URLs, OG images, social cards).
5. **Substack/Beehiiv discovery networks** — explicitly low-value for hyper-local civic content. The "creator economy" recommendation graph doesn't index transit advocacy meaningfully. Not worth optimizing for.

## Why hybrid, not all-in-one

We considered putting the newsletter on the site (canonical-on-our-domain) and putting the site on a publishing platform (Substack/Beehiiv/Ghost as the canonical surface). Both lose something the hybrid keeps.

- **All-on-site** forces the website's engineering effort into "make the newsletter look beautiful in MDX" instead of into interactive tools and data infrastructure. It also requires non-technical staff to author site content, which creates a CMS problem we don't yet need to solve.
- **All-on-Substack/Beehiiv** trades brand control, on-our-domain SEO, and content portability for ease. For an advocacy org that wants to be a citation source, those are the wrong tradeoffs.

Hybrid frees the website to be a **tools/data/journalism platform** — the highest-leverage role for an advocacy org's website — while putting the newsletter on a platform built for newsletters, where staff can author without touching git.

## Innovation pillars (direction, not commitments)

Three editorial/product directions LVBT will invest in. The site reserves URL slots and stack capability for each. None are v0 build commitments — each is built when bandwidth and content readiness allow.

### 1. Data journalism / scrollytelling — `/explainers/`

Pudding-style narrative explainers. First piece (working title): "The Valley We Could Build" — paint urgency for the LVBT vision. Story arc: Valley today (sprawl, transit-dependence) → the threat (42% RTC route cuts looming without 2027 NV funding action) → what we lose → what's possible (Maryland Pkwy BRT, Charleston LRT, Brightline West, valley-wide network) → comparisons (Phoenix, Denver, Portland) → the ask.

Tech when built: scrollama for scroll triggers, Observable Plot for charts, MapLibre GL JS for maps. Heavy assets via R2.

Effort estimate when built: ~2–3 focused weeks. Content (data gathering, story arc, writing) is 50%+ of the work — line up sources before any visualization code.

### 2. Personalized civic engagement tools — `/tools/`

First tool: Find-your-reps + take action. ZIP → RTC board rep, county commissioner, state legislator + current transit voting record + pre-drafted email/call template. Most advocacy CTAs are generic; LVBT's are personal.

Effort estimate when built: ~1–2 weeks for the first tool. Becomes the anchor for every newsletter CTA.

### 3. Public data dashboard — `/data/`

Live RTC ridership, on-time performance, route changes. Updated nightly via Cloudflare Worker cron pulling GTFS / RTC public data into D1. Goal: become the citation reflex for every journalist writing about Vegas transit. Build the dashboard RTC should have built.

Effort estimate when built: ~3–4 weeks. Highest engineering investment of the three.

### Pillar order

Suggested build order: scrollytelling first (defines editorial voice, big-bang shareable, content-led), civic engagement tools second (shorter scope, immediate utility), dashboard last (longest engineering tail, compounds over time).

## Architecture decisions

### Newsletter platform: Ghost(Pro) Starter on `journal.lasvegasfortransit.org`

$9/mo. Custom domain. Modern editor, hosted email, members system. We own and can export the subscriber list. Staff sign in with their Workspace identity (no GitHub required to publish).

**Why not Substack:** Substack inverts the canonical-content model. Posts live at `lvbt.substack.com/p/...` even with a custom domain — Substack chrome on every page, content not portable as MDX, weaker SEO on our own domain. Also moderation baggage for a civic-advocacy posture.

**Why not self-hosted Ghost:** Founder bandwidth is the binding constraint. Ghost requires a long-running Node.js host (Cloudflare Pages can't run it), MySQL, Mailgun for bulk sends, and ~2–4 hours/month of ops. $9/mo for zero ops beats $5–12/mo VPS + ongoing patch/backup work.

**Revisit self-hosting when both are true:** (a) crossing 2+ staff seats forces a Ghost(Pro) Creator upgrade ($25/mo) anyway, flipping the economics, AND (b) someone on the team has ops capacity. Migration path is well-trodden — Ghost has full export/import; custom domain stays the same; subscribers don't notice.

### Site stack: Astro + Cloudflare full-stack

Already locked: Astro 5 + MDX + Tailwind v4 + TypeScript (strict) on Cloudflare Pages. Extends to Workers + cron, D1, KV, R2, and Access for Google Workspace SSO on any future internal admin URLs (free up to 50 users).

The pillar builds use this stack — Worker crons for data ingestion, D1 for structured data, R2 for heavy assets, Access for any admin tools that need staff identity. Nothing exotic to add when the time comes.

### Auth for staff content tools (deferred)

v0 has no contributor CMS. Founder authors MDX directly. When a second contributor joins, two paths to evaluate:

- **Keystatic with GitHub OAuth.** Each contributor creates a free GitHub account using their Workspace email. Simplest setup. ~5 min one-time per person.
- **Cloudflare-Access-gated custom admin** with service-account commits. Contributors sign in via Workspace SSO; commits go through a shared bot account (authorship in commit body). No GitHub needed; more custom plumbing.

Decide based on contributor count and tech comfort when the moment arrives.

## What's NOT in this strategy

- **Urgent/mobilization stream** (action alerts that don't need permanent posts) — separate decision when the org actually has urgent mobilization needs. Bias: same Ghost list with a "rapid alerts" tag/segment, or Bluesky/IG for time-sensitive blasts.
- **Donations** — external link (Givebutter/Donorbox), not on-site processing.
- **Multimedia (podcast, video)** — future.
- **Open-source movement infrastructure** — long-term play to package the toolkit for transit advocates in other car-dependent metros. Not v0; not v1.

## Trigger conditions to revisit this strategy

- Newsletter list crosses 500 subscribers → revisit Ghost(Pro) tier; check whether MailerLite/Buttondown migration makes sense (it likely doesn't, but the 500-sub Ghost(Pro) Starter ceiling is the moment to look).
- Second contributor joins → CMS decision (Keystatic vs. Cloudflare-Access admin).
- Self-hosting Ghost preconditions hit (see above).
- A pillar build is about to start → write a focused implementation plan; this doc is the strategic frame, not the build spec.
