# Decision: Newsletter platform

This decision record explains which service we send the newsletter through and why — read it before proposing a platform change. The names below are competing newsletter/publishing services; **Ghost(Pro)** is the hosted version of the open-source Ghost publishing platform, **Substack** and **Beehiiv** are popular hosted newsletter platforms, and the rest are email-sending services.

**Decision:** Ghost(Pro) Starter ($9/mo) on `journal.lasvegasfortransit.org`. Hybrid model — site is canonical for everything else (reference, tools, data, journalism); Ghost is canonical for the serial newsletter.

**Date:** 2026-05-01

## Context

Brand-new advocacy org. Founder is technical; future contributors likely won't be. Year 1 newsletter ceiling realistically ~500 subscribers. Tight budget. Need: long-form analysis + monthly/bi-weekly org updates, with the option to grow.

Initial v0 plan called for "Beehiiv embed" on the site. Reopened the decision because:

1. The subscriber list is a core organizational asset that's painful to migrate later.
2. The website's highest-leverage role for an advocacy org is **a tools/data/journalism platform**, not a publication wrapper. Engineering effort spent on "make the newsletter look beautiful in MDX" is better spent on interactive tools, public data infrastructure, and data journalism.
3. Newsletter authoring needs to be staff-friendly. Staff have Workspace identities, not necessarily GitHub.

## Decisions made along the way

The path the analysis took, in order — useful so future-you can spot when an assumption changed:

1. **Email-only ESP + canonical-on-site** (publish on lvbt.org, email is push). Initially favored Buttondown for its markdown-native composer and indie posture. Then reconsidered when we agreed the website should focus on tools/data/journalism, freeing the newsletter to live elsewhere with its own reader experience.
2. **Hybrid model** (newsletter has its own surface; site is canonical for everything else). Email-only services dropped out of the running because they don't provide a reader experience.
3. **Ghost(Pro) over Substack/Beehiiv** for brand control + portability + ethics fit.

## Alternatives considered

### Email-only services (publication lives on lvbt.org; email is push notification)

| Service                 | Strengths                                                                              | Why ruled out                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Buttondown              | Markdown-native composer, indie/bootstrapped, first-class subscriber export, $0–$9/mo  | Email-only — doesn't fit hybrid model where newsletter has its own reader surface |
| MailerLite              | WYSIWYG editor, free up to 1000 subs / 12k emails/mo, strong for non-tech contributors | Same shape problem — email-only                                                   |
| Resend Broadcasts       | Dev-friendly, React Email templates, best deliverability tier for the price            | Doesn't fit a "non-tech contributor adds intro and clicks send" workflow          |
| EmailOctopus            | Free up to 2500 subs, RSS campaigns                                                    | Email-only                                                                        |
| Mailchimp               | Mature, well-known, RSS campaigns                                                      | Email-only; UI bloat for the value                                                |
| Loops, Kit (ConvertKit) | Modern, dev-friendly                                                                   | Email-only                                                                        |
| Self-hosted Listmonk    | Free, full control, BYO SMTP                                                           | Ops burden incompatible with one-person org shipping content                      |

### Publication platforms (newsletter has its own reader experience)

**Substack** — Easiest setup, free at scale, best non-tech editor, free custom domain. **Ruled out:**

- Inverts the canonical-content model — posts live at substack.com URLs even with a custom domain (Substack chrome on every page)
- Content not portable as MDX — exporting later is a CSV-of-content migration that loses component embeds
- Aesthetic conflict with the site's narrow-blocks-in-wide-containers design
- Moderation baggage (recurring controversies around hosted content) — potential brand mismatch for a civic-advocacy org whose audience leans left/center-left
- Runs against host-portable posture — fully vendor-locked, content trapped in their database

**Beehiiv** — Newer, growth-oriented, free up to 2500 subs. **Ruled out:**

- Custom domain requires Scale plan ($39/mo)
- On free tier, you publish at lvbt.beehiiv.com with Beehiiv chrome — worse brand match than Substack's free custom domain
- Growth-recommendation features (cross-Beehiiv promotion) have low value for hyper-local civic content

**Ghost — replace Astro with Ghost** — Throws out the Apple-Store-aesthetic site already built. Ghost themes are Handlebars, not Astro components. Custom MDX components, narrow-blocks layout, hero alternation — rebuilt or lost. **Hard no.**

**Ghost — headless feeding Astro** — Ghost as backend (content + email), Astro renders via Content API. Coherent but: content lives in Ghost's database (loses MDX-in-repo portability), adds a second system, costs scale by staff seat ($9/$25/$50 for 1/2/5 staff). **Considered, not picked** — too much added complexity for the gain.

**Self-hosted Ghost** — running Ghost yourself on a rented server instead of paying Ghost to host it. $5–12/mo VPS (a "virtual private server" — a rented Linux machine you manage; Fly.io and Hetzner are two such server hosts, ~$5–10/mo and €4–5/mo, plus DigitalOcean $6–12/mo with 1-click droplet and Pikapods ~$5/mo managed-self-hosted) + $0–15/mo Mailgun (a service that does the actual bulk email delivery). Note: Ghost has a hardcoded Mailgun integration for **bulk** newsletter sends; other SMTP (the email-sending protocol) providers work for transactional only. **Ruled out for v0:** founder bandwidth is the binding constraint; ~2–4 hours/month ops is the wrong trade vs. $9/mo for zero ops. Documented as a future option — see "Trigger conditions" below.

**Ghost(Pro) Starter — selected.**

## Why Ghost(Pro)

- $9/mo. Custom domain. Modern editor. Hosted email. Members system.
- Owns and exports the subscriber list (CSV) — first-class feature.
- Staff sign in with their Workspace identity — no GitHub required.
- Ghost theme can be tuned to roughly match the site's aesthetic (~half-day work).
- Migration path to self-hosted is well-trodden if/when the time comes.

## Trigger conditions to revisit

- **Crossing 2 staff seats:** Starter (1 staff) → Creator ($25/mo, 2 staff). At that price point, self-hosted Ghost (with Mailgun) starts to look better economically — IF someone has ops capacity.
- **Crossing 1000 subscribers:** revisit pricing tier and whether features at higher tiers (recommendations, paid memberships if relevant) are worth it.
- **Deliverability or rendering ceiling hit:** if Ghost's email rendering or send infrastructure becomes limiting, evaluate Resend Broadcasts with a custom admin layer.

## Migration paths

- **Ghost(Pro) → self-hosted Ghost:** Ghost has full export/import for posts, members, subscriptions. Custom domain stays the same; subscribers don't notice. ~1–2 days focused work.
- **Ghost(Pro) → another platform entirely:** subscriber CSV export works at any size; content export is more involved (Ghost's mobiledoc/Lexical format → portable HTML/markdown).

## Addendum: LVBT uses Beehiiv (2026-09-23)

The comparison above is kept as written, as the record of how this decision was first reached. In practice, LVBT's newsletter has run on Beehiiv, not Ghost(Pro), since the website's first newsletter sign-up form, and it still does. Its web address is `mail.lasvegasfortransit.org`. This record doesn't capture why the recommendation wasn't followed; if that matters for a future decision, ask the people who set up the newsletter.

The website's code works with Beehiiv because that's where LVBT's mailing list lives. Joining LVBT on the website subscribes the person in Beehiiv, in the same step that creates their record and records their consent (see [membership intake](../../reference/membership-intake.md)). Being on the mailing list is what makes someone a member today, so the two are kept in step. The [Organizing Platform decision record](./organizing-platform.md) keeps Beehiiv behind its own integration, so the newsletter could move to another service later without changing the platform's rules.

Transactional email is separate from the newsletter and doesn't go through Beehiiv. That means any email sent to one person because of something they did, such as a sign-in code or a welcome message. It goes through Resend, sent from `notify.lasvegasfortransit.org`, so a delivery problem there can't harm the newsletter's sending reputation. The Organizing Platform decision record explains that choice.

The "Trigger conditions to revisit" above were written for Ghost(Pro) and no longer apply. A future decision about the newsletter platform belongs in a new decision record.
