# Decision: Staff publishing for site content

This record is about how non-technical staff will eventually edit the website without learning git.
A **CMS** (content management system) is the admin tool that lets someone write and edit site
content through a friendly web interface instead of editing code files by hand. Two flavors come up
below: a **git-backed CMS** keeps the content as files in our code repository and saves edits as git
commits (so the content stays in the repo, just with a nicer editor on top), while a **headless
CMS** stores the content in the vendor's own database and the site fetches it over an API at build
time (more convenient to edit, but the content no longer lives in our repo).

**Decision:** Deferred. Founder authors MDX directly in v0. Pick a CMS path when the second
contributor joins.

**Date:** 2026-05-01 (decision deferred)

## Context

Site content is MDX in `src/content/`. Editing requires git knowledge today. Future contributors
will not all be technical. LVBT staff have Google Workspace identities (`@lasvegasfortransit.org`);
not all have GitHub accounts.

The newsletter side of this is solved by Ghost(Pro)'s native auth and editor (see
[newsletter-platform.md](./newsletter-platform.md)). The site side is the open question — when a
non-technical contributor joins, how do they edit project pages, fact sheets, About content, etc.,
without learning git?

## Alternatives considered

### Git-backed CMS, browser editor

Content stays as MDX in repo. CMS provides a WYSIWYG editor in the browser; saves commit through
git.

| Tool                                 | Notes                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Keystatic**                        | Open-source by Thinkmill, designed for Astro, free. Modern block-based editor. Auth via GitHub OAuth (the standard "sign in with GitHub" flow — OAuth, "Open Authorization," lets one app log you in using your account on another) — every contributor needs a free GitHub account. |
| **Sveltia CMS**                      | Actively-maintained successor to Decap. Framework-agnostic. Same git-backed model and same auth constraint.                                                                                                                                                                          |
| **Decap CMS** (formerly Netlify CMS) | Same shape. Less actively maintained; Sveltia is the better current choice.                                                                                                                                                                                                          |
| **TinaCMS**                          | Visual editing on top of MDX. Hosted backend ($29/mo team) or self-hostable. Slickest editor of this group.                                                                                                                                                                          |
| **Pages CMS**                        | Cloudflare-Pages-native, lightweight. GitHub-auth-based. Newer, less mature.                                                                                                                                                                                                         |

**Key constraint:** all of these auth via GitHub. Each contributor needs a free GitHub account (~5
min one-time signup using their Workspace email, added to a `lasvegasfortransit` GitHub org).

### Headless CMS, content in vendor's database

| Tool                              | Notes                                                                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sanity, Contentful, Storyblok** | Database-backed. Content fetched via API at build time. Loses the MDX-in-repo benefit; introduces vendor lock-in for content. Not aligned with the project's portability posture. |

### Custom admin gated by Cloudflare Access

Build a thin admin route at `admin.lasvegasfortransit.org`, gated by Cloudflare Access (Google
Workspace SSO, free up to 50 users). Contributors sign in with their Workspace identity. The admin
commits to git via a service-account PAT (personal access token — a secret, password-like string
that lets a script act on GitHub on a "bot" account's behalf) — git authorship shows "LVBT-bot" with
the actual editor captured in the commit body.

**Pros:** No GitHub accounts needed. Leverages existing Cloudflare + Workspace stack. Maintains
MDX-in-repo. **Cons:** Custom plumbing — Keystatic and similar CMSes don't ship this mode
out-of-the-box. Real engineering investment.

### Ghost headless feeding Astro

Use Ghost as the CMS for site content too (not just newsletter). Astro fetches via Ghost Content
API.

**Pros:** Single editing surface (newsletter + site), no GitHub required, slick editor. **Cons:**
Content not in repo (loses MDX portability). Two systems (or all-on-Ghost, which conflicts with the
hybrid decision). Costs scale by staff seat.

## Why deferred

There's no second contributor today. Building a CMS now solves a problem that doesn't exist yet, and
the right answer depends on:

- How many contributors join, how often
- Whether they're tech-comfortable enough for Keystatic + GitHub OAuth (likely yes for most
  civic-tech-adjacent volunteers)
- Whether the site's content shape stays MDX-heavy or gets more structured (events, scorecards,
  dashboards)

## Decision criteria when the time comes

When the second contributor joins, pick based on:

- **If contributor is tech-comfortable:** Keystatic with GitHub OAuth. Lowest engineering work;
  preserves MDX-in-repo. Each contributor creates a free GitHub account using their Workspace email
  — ~5 min one-time onboarding, then they only ever touch the CMS UI.
- **If contributors are not tech-comfortable AND there's engineering bandwidth for the auth
  plumbing:** Cloudflare-Access-gated custom admin with service-account commits. Workspace SSO; no
  GitHub. ~3–4 days engineering vs. ~1–2 days for Keystatic.
- **If 3+ contributors quickly AND content shape moves toward structured (scorecards, events,
  dashboards):** consider whether a structured CMS makes sense for those content types specifically,
  while keeping MDX for long-form.

## Constraints

- Staff have Workspace identities, not necessarily GitHub.
- Site content should stay portable (MDX in repo preferred over database-backed).
- Cloudflare Access is already available (free up to 50 users) for any auth gate we choose.

## Related

- [Comms strategy](../comms-strategy.md) — strategic frame
- [Newsletter platform decision](./newsletter-platform.md) — staff-friendly newsletter publishing is
  solved separately
