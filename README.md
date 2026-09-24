# lasvegasfortransit.org

The website for **Las Vegans for Better Transit**, a grassroots advocacy organization fighting for world-class public transit and supportive land use in the Las Vegas Valley.

> **New contributor?** You don't need to know our stack to help. Start at
> [`docs/tutorials/start-here.md`](./docs/tutorials/start-here.md), and keep the
> [glossary](./docs/reference/glossary.md) open for any unfamiliar term.

## Stack

New to any of these? Each links to its [glossary](./docs/reference/glossary.md) entry.

- [Astro](./docs/reference/glossary.md#astro) — the framework that builds the site into fast [static](./docs/reference/glossary.md#static-site) HTML
- [MDX](./docs/reference/glossary.md#mdx) [content collections](./docs/reference/glossary.md#content-collection) (Markdown-plus-components content) with [Zod](./docs/reference/glossary.md#zod)-validated [frontmatter](./docs/reference/glossary.md#frontmatter), so a typo fails the build instead of shipping
- [Tailwind](./docs/reference/glossary.md#tailwind) CSS v4 (via `@tailwindcss/vite`)
- [Public Sans](https://public-sans.digital.gov/) (USWDS font, self-hosted; Latin woff2 vendored from `@fontsource-variable/public-sans`)
- Hosted on [Cloudflare Pages](./docs/reference/glossary.md#cloudflare-pages) — fully portable to any static host (Netlify, GitHub Pages, S3+CloudFront).

---

## Getting started

To preview the site on your own computer — all most contributors ever need:

```sh
pnpm install   # one-time: install dependencies
pnpm dev       # start the local site at https://lvbt.localhost
```

That's it: edit a file, see it update live. New to the project or our tools?
[`docs/tutorials/start-here.md`](./docs/tutorials/start-here.md) walks through
this from scratch, and the [glossary](./docs/reference/glossary.md) defines any
unfamiliar term.

### Full setup (deploying your own copy)

`pnpm bootstrap` is a single command that takes an empty checkout all the way to a
deployed site. It runs eight phases in order — `install` → `auth` → `workspace` →
`env` → `repo` → `deploy` → `domain` → `secrets`. Every phase checks what already
exists first, so running it again is safe and an interrupted run picks up where
it stopped:

```sh
pnpm install
pnpm bootstrap   # full interactive setup; add --local-only to skip GitHub/Cloudflare
```

For what each phase does, the other flags, and how to add a phase, see the
[bootstrap reference](./docs/reference/bootstrap.md); the
[first-time-setup tutorial](./docs/tutorials/first-time-setup.md) is the
hand-held version.

---

## Day-to-day commands

| Command             | Action                                                                             |
| ------------------- | ---------------------------------------------------------------------------------- |
| `pnpm dev`          | Local dev server at https://lvbt.localhost                                         |
| `pnpm build`        | Build production site to `./dist/`                                                 |
| `pnpm preview`      | Serve `./dist/` locally                                                            |
| `pnpm typecheck`    | Type-check the Astro app + bootstrap CLI                                           |
| `pnpm lint`         | Format the codebase with Prettier                                                  |
| `pnpm lint:check`   | Verify formatting (CI mode — exits non-zero on diff)                               |
| `pnpm test`         | Visual-regression sweep of every page (see [`tests/README.md`](./tests/README.md)) |
| `pnpm test:update`  | Refresh visual-regression baselines after intentional UI changes                   |
| `pnpm test:install` | One-time: download the Chromium build Playwright uses                              |
| `pnpm preflight`    | Re-check readiness without making changes                                          |

## Editing content

The full docs live in [`docs/`](./docs/), organized so you can find things by what you're trying to do (the [Diátaxis](https://diataxis.fr/) system). New here? Begin at [**Start here**](./docs/tutorials/start-here.md); for everything else, the [docs index](./docs/README.md) lists it all. Common entry points:

- [Start here](./docs/tutorials/start-here.md) — the new-contributor on-ramp
- [Glossary](./docs/reference/glossary.md) — plain-English definitions of every tool and acronym
- [Add an event](./docs/guides/add-an-event.md)
- [Add a project](./docs/guides/add-a-project.md)
- [Edit a long-form doc](./docs/guides/edit-a-long-form-doc.md)
- [Voice and tone](./docs/explanation/voice-and-tone.md) — read before drafting
- [Content collections reference](./docs/reference/content-collections.md)

### Adding an event

Events live in the LVBT Google Calendar, not in this repo. Create the event there; the site rebuilds against the calendar hourly. For events that need long-form copy on their detail page, scaffold an optional MDX body fragment with `pnpm event:new`. Full reference: [docs/explanation/events-pipeline.md](./docs/explanation/events-pipeline.md).

## Project structure

```
src/
  content/                  # All editable content (MDX + JSON)
    docs/                   # Long-form essays
    pages/                  # Page body copy
    event-bodies/           # Optional long-form body per event (events themselves live in Google Calendar)
    projects/               # Project briefs
    initiatives/            # Project tags (JSON)
  layouts/                  # BaseLayout, DocLayout
  components/               # Reusable UI
  pages/                    # Astro file-based routing
  lib/site.ts               # Single source of truth for org metadata (reads from PUBLIC_LVBT_*)
  styles/global.css         # Tailwind + design tokens
public/                     # Static assets, favicon, robots.txt
scripts/bootstrap/          # The bootstrap CLI (TypeScript via tsx)
tests/                      # Playwright visual-regression harness (see tests/README.md)
src/content.config.ts       # Zod schemas for content collections
astro.config.mjs            # Astro + integrations
playwright.config.ts        # Playwright config (webserver, viewports, snapshot path)
.env.example                # Documents PUBLIC_LVBT_* env vars
```

## Deployment

Pushes to `main` deploy to production at `lasvegasfortransit.org` via GitHub Actions; PRs get a Cloudflare Pages preview URL commented on the PR. Full pipeline (build settings, env vars, rollback, manual deploys) is documented in [`docs/reference/deployment-pipeline.md`](./docs/reference/deployment-pipeline.md).

If anything breaks in your environment, run `pnpm preflight` first — it usually points at the missing piece.

## CI/CD

Several workflows in [`.github/workflows/`](./.github/workflows/) build on three reusable composites in [`.github/actions/`](./.github/actions/) (`setup-node-pnpm`, `build-site`, `deploy-cloudflare-pages`). The ones that talk to Cloudflare:

| Workflow                      | Trigger                               | What it does                                                                   |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| `deploy-preview.yml`          | Same-repo PRs on `main`               | Build + `wrangler pages deploy --branch=<head ref>` + comment URL              |
| `deploy-production.yml`       | Pushes to `main`, `workflow_dispatch` | Build + `wrangler pages deploy --branch=main`                                  |
| `deploy-worker-preview.yml`   | Same-repo PRs, once enabled           | Uploads a version of the separate `lvbt-website-preview` Worker for comparison |
| `deploy-worker-candidate.yml` | After a successful production build   | Uploads a `main` Worker version for comparison, then cutover once enabled      |

`ci.yml` (typecheck → lint:check → check:docs → build, no deploy), `audit.yml`, `audit-scheduled.yml`, `cron-rebuild.yml` and `seed-baselines.yml` need no Cloudflare credentials. The full pipeline — every setting and the exact dashboard clicks for each token — is in [`docs/reference/deployment-pipeline.md`](./docs/reference/deployment-pipeline.md) and [`docs/guides/test-the-workers-candidate.md`](./docs/guides/test-the-workers-candidate.md).

**In short:** `deploy-production.yml` and `deploy-preview.yml` both need a repository secret `CLOUDFLARE_API_TOKEN` (an **Account · Cloudflare Pages · Edit** custom token — Cloudflare has no ready-made template for Pages alone) and a repository variable `CLOUDFLARE_ACCOUNT_ID`. Both stay at the repository level, not scoped to an Environment: `deploy-preview.yml`'s fork-safety job, which declares no environment, reads them too. `deploy-worker-preview.yml` and `deploy-worker-candidate.yml` each need their own environment-scoped `CLOUDFLARE_WORKERS_API_TOKEN` (a narrower **Account · Workers Scripts · Edit** token) under the `worker-preview` and `worker-candidate` GitHub environments.

## License

Site code: MIT. Editorial content (the org's vision, strategy, etc.): all rights reserved by Las Vegans for Better Transit.
