# Comms strategy

Contributors and editors use this page to decide what LVBT publishes and where it belongs. Read it
before adding a content type or proposing a publishing platform change.

This strategy preserves the original Ghost proposal below. LVBT uses Beehiiv at
`mail.lasvegasfortransit.org`; see the
[2026-09-23 newsletter decision addendum](./decisions/newsletter-platform.md#addendum-lvbt-uses-beehiiv-2026-09-23).
The Ghost section and its prices describe the earlier proposal, not current newsletter operations.
The three proposed content directions remain planning guidance, not a claim that the tools exist.

## The hybrid surface model

**The problem:** an advocacy org has several different jobs to do — host reference material and
interactive tools, publish a serial newsletter, and post quick updates to social media. Cramming all
of that into one platform forces painful tradeoffs (a website bent into a newsletter tool, or a
newsletter platform that owns your URLs and SEO). The **hybrid surface model** separates these jobs.
A surface is a place readers find content: the website, newsletter, or social media. The website
hosts reference material, tools, data, and journalism. A separate newsletter service hosts and sends
the newsletter.

| Surface                                 | Role                                                                                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lasvegasfortransit.org`                | Reference + tools + data + journalism. Project pages, About, fact sheets, glossary, scrollytelling explainers (long reads where charts and maps animate as you scroll), interactive tools, public data dashboard. |
| `mail.lasvegasfortransit.org` (Beehiiv) | Serial newsletter — long-form analysis, monthly/bi-weekly org updates.                                                                                                                                            |
| Instagram + Bluesky                     | Daily/weekly visual storytelling. Drives traffic to site pieces and newsletter signups.                                                                                                                           |
| Earned / press                          | Journalists can cite the site's analyses. LVBT becomes a citation source.                                                                                                                                         |

After publishing an explainer, tool, or data update, editors explain it in the newsletter and share
it on social media. Readers can return to the site and choose to subscribe.

## Audiences

The newsletter and site serve different priority audiences with different needs. Order matters when
making editorial choices.

1. **Engaged supporters** — already know LVBT, want depth. Newsletter is the primary surface for
   them. Tone: direct, substantive, treats them as insiders.
2. **Curious newcomers** — Google "Las Vegas transit" or "RTC
   ([Regional Transportation Commission](../reference/glossary.md#rtc), the agency that runs the
   buses) budget cuts" and find LVBT. Site is their entry point; we want to give them a reason to
   subscribe to the newsletter. Tone: explanatory but never condescending.
3. **Decision-makers / journalists** — looking for citable analysis. Site is what they bookmark and
   quote. SEO (search engine optimization — showing up in Google results) and URL permanence on our
   own domain need to remain reliable. Tone: rigorous, sourced, quotable.
4. **Cross-movement allies** — adjacent civic orgs, transit advocates in other cities. The long-term
   plan is to share reusable tools with these groups. Tone: peer-to-peer, generous with what we've
   learned.

## Ladder of engagement

Stranger → reader (one site visit) → returning reader → newsletter subscriber → donor → volunteer →
activist showing up at RTC meetings. Each platform serves different transitions:

- **Social (Instagram/Bluesky):** stranger → reader.
- **Site:** reader → returning reader → subscriber.
- **Newsletter:** subscriber → donor → volunteer.
- **In-person events:** volunteer → activist.

Don't expect any single surface to do all of it. Editorial choices for each surface should reflect
which transitions it's responsible for.

## Distribution / discovery

Where new readers come from, in priority order:

1. **SEO** — Google searches for transit topics specific to Vegas. Best supported by original
   content on `lasvegasfortransit.org` (project pages, scrollytelling explainers, fact sheets). Cuts
   against publishing on third-party platforms (Substack and Beehiiv — popular hosted newsletter
   services that put your content on _their_ domain; see
   [Beehiiv glossary](../reference/glossary.md#beehiiv)) that split links and search visibility
   across several domains.
2. **Press / earned media** — journalists citing LVBT analyses. Keeping original content on our
   domain helps here too — reporters link to a stable, branded URL.
3. **Cross-promotion with adjacent civic orgs** — local, plays well at any scale.
4. **Direct sharing** — supporters forwarding the newsletter or sharing site pieces. Use readable
   addresses and useful preview images and text when people share links.
5. **Substack/Beehiiv discovery networks** — explicitly low-value for hyper-local civic content.
   Recommendations between newsletter writers do not reliably reach people interested in local
   transit advocacy. Not worth optimizing for.

## Why hybrid, not all-in-one

We considered putting the newsletter on the site (canonical-on-our-domain) and putting the site on a
publishing platform (Substack/Beehiiv/Ghost as the canonical surface). Both lose something the
hybrid keeps.

- **All-on-site** forces the website's engineering effort into "make the newsletter look beautiful
  in MDX" instead of into interactive tools and data infrastructure. It also requires non-technical
  staff to author site content, which requires a content management system (CMS), an editor for
  people who do not edit files. The original plan deferred that decision.
- **All-on-Substack/Beehiiv** trades brand control, on-our-domain SEO, and content portability for
  ease. For an advocacy org that wants to be a citation source, those are the wrong tradeoffs.

Hybrid frees the website to be a **tools/data/journalism platform** — the most useful role proposed
for LVBT's website — while putting the newsletter on a platform built for newsletters, where staff
can author without touching git.

## Innovation pillars (direction, not commitments)

Three editorial/product directions LVBT will invest in. The plan reserves website addresses and
suitable tools for each. None are v0 build commitments — each is built when contributors have time
and the content is ready.

### 1. Data journalism / scrollytelling — `/explainers/`

Interactive explainers in the style of The Pudding, a publication that combines stories with data.
First piece (working title): "The Valley We Could Build" — paint urgency for the LVBT vision. Story
arc: Valley today (sprawl, transit-dependence) → the threat (42% RTC route cuts looming without 2027
NV funding action) → what we lose → what's possible (Maryland Pkwy
[BRT](../reference/glossary.md#brt), Charleston [LRT](../reference/glossary.md#lrt), Brightline
West, valley-wide network) → comparisons (Phoenix, Denver, Portland) → the ask.

Tech when built: scrollama for scroll triggers, Observable Plot (a JavaScript charting library) for
charts, MapLibre GL JS (an open-source library for interactive vector maps) for maps. Heavy assets
via R2 (Cloudflare's object storage — see the D1/KV/R2 note below).

Effort estimate when built: ~2–3 focused weeks. Content (data gathering, story arc, writing) is 50%+
of the work — line up sources before any visualization code.

### 2. Personalized civic engagement tools — `/tools/`

First tool: Find-your-reps + take action. ZIP → RTC board rep, county commissioner, state
legislator + current transit voting record + pre-drafted email/call template. Calls to action (CTAs)
should connect the request to the reader's own trip or representatives.

Effort estimate when built: ~1–2 weeks for the first tool. The newsletter can link readers directly
to the tool when asking them to act.

### 3. Public data dashboard — `/data/`

Live RTC ridership, on-time performance, route changes. Updated nightly via Cloudflare Worker cron
pulling GTFS (General Transit Feed Specification — the standard format agencies publish routes and
schedules in; see [glossary](../reference/glossary.md#gtfs)) / RTC public data into D1. The goal is
to give journalists a reliable source for Las Vegas transit figures. Build the dashboard RTC should
have built.

Effort estimate when built: ~3–4 weeks. Highest engineering investment of the three.

### Pillar order

Build the interactive explainer first to establish the editorial voice with a story people can
share. Build civic engagement tools next because the first tool has a smaller scope and helps
readers act. Build the dashboard last because it requires the most engineering and ongoing data
work.

## Architecture decisions

### Newsletter platform: Ghost(Pro) Starter on `journal.lasvegasfortransit.org`

This subsection preserves the original proposal. The Beehiiv addendum linked above supersedes it.

$9/mo. Custom domain. Modern editor, hosted email, members system. We own and can export the
subscriber list. Staff sign in with their Workspace identity (no GitHub required to publish).

**Why not Substack:** Substack inverts the canonical-content model. Posts live at
`lvbt.substack.com/p/...` even with a custom domain — Substack chrome on every page, content not
portable as MDX, weaker SEO on our own domain. Also moderation baggage for a civic-advocacy posture.

**Why not self-hosted Ghost:** Founder bandwidth is the binding constraint. Ghost requires a
long-running Node.js host (Cloudflare Pages can't run it), MySQL, Mailgun for bulk sends, and ~2–4
hours/month of ops. $9/mo for zero ops beats $5–12/mo VPS + ongoing patch/backup work.

**Revisit self-hosting when both are true:** (a) crossing 2+ staff seats forces a Ghost(Pro) Creator
upgrade ($25/mo) anyway, flipping the economics, AND (b) someone on the team has ops capacity.
Migration path is well-trodden — Ghost has full export/import; custom domain stays the same;
subscribers don't notice.

### Site stack: Astro + Cloudflare full-stack

The stack uses Astro 7, MDX, Tailwind v4, and TypeScript with strict checks on Cloudflare Workers
(see the [organizing platform decision](./decisions/organizing-platform.md)). Extends to Worker cron
triggers, and Cloudflare's storage trio — **D1** (a SQL database), **KV** (a simple key-value store
for small fast lookups), and **R2** (file/object storage for large media) — plus Access for Google
Workspace SSO (single sign-on — staff log in once with their Workspace account) on any future
internal admin URLs (free up to 50 users).

The pillar builds use this stack — Worker crons for data ingestion, D1 for structured data, R2 for
heavy assets, Access for any admin tools that need staff identity. Each project still needs its own
data, permission, and operating plan.

### Auth for staff content tools (deferred)

The original v0 plan deferred a contributor CMS and had the founder edit MDX files directly. When a
second contributor joins, two paths to evaluate:

- **Keystatic with GitHub OAuth.** Keystatic is an open-source content editor that gives
  non-technical staff a friendly browser UI while keeping the content as files in our repo; OAuth
  ("Open Authorization") is the standard "sign in with GitHub" flow. Each contributor creates a free
  GitHub account using their Workspace email. Simplest setup. ~5 min one-time per person.
- **Cloudflare-Access-gated custom admin** with service-account commits. Contributors sign in via
  Workspace SSO; commits go through a shared bot account (authorship in commit body). No GitHub
  needed; developers must build the sign-in and commit connection.

Decide based on contributor count and tech comfort when the moment arrives.

## What's NOT in this strategy

- **Urgent/mobilization stream** (action alerts that don't need permanent posts) — separate decision
  when the org actually has urgent mobilization needs. The original preference was the same Ghost
  list with a "rapid alerts" tag/segment, or Bluesky/IG for time-sensitive blasts.
- **Donations** — external link (Givebutter/Donorbox), not on-site processing.
- **Multimedia (podcast, video)** — future.
- **Open-source movement infrastructure** — long-term play to package the toolkit for transit
  advocates in other car-dependent metros. Not v0; not v1.

## Trigger conditions to revisit this strategy

- Newsletter list crosses 500 subscribers → review the original Ghost(Pro) assumption; check whether
  MailerLite/Buttondown migration makes sense (it likely doesn't, but the 500-sub Ghost(Pro) Starter
  ceiling is the moment to look).
- Second contributor joins → CMS decision (Keystatic vs. Cloudflare-Access admin).
- Self-hosting Ghost preconditions hit (see above).
- A pillar build is about to start → write a focused implementation plan; this doc is the strategic
  frame, not the build spec.
