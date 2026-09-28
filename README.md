# lasvegasfortransit.org

The website for **Las Vegans for Better Transit**, a grassroots advocacy organization fighting for
world-class public transit and supportive land use in the Las Vegas Valley.

> **New contributor?** You don't need to know our stack to help. Start at
> [`docs/tutorials/start-here.md`](./docs/tutorials/start-here.md), and keep the
> [glossary](./docs/reference/glossary.md) open for any unfamiliar term.

## Stack

New to any of these? Each links to its [glossary](./docs/reference/glossary.md) entry.

- [Astro](./docs/reference/glossary.md#astro) — the framework that builds the site into fast
  [static](./docs/reference/glossary.md#static-site) HTML
- [MDX](./docs/reference/glossary.md#mdx)
  [content collections](./docs/reference/glossary.md#content-collection) (Markdown-plus-components
  content) with [Zod](./docs/reference/glossary.md#zod)-validated
  [frontmatter](./docs/reference/glossary.md#frontmatter), so a typo fails the build instead of
  shipping
- [Tailwind](./docs/reference/glossary.md#tailwind) CSS v4 (via `@tailwindcss/vite`)
- [Public Sans](https://public-sans.digital.gov/) (USWDS font, self-hosted; Latin woff2 vendored
  from `@fontsource-variable/public-sans`)
- Hosted on [Cloudflare Pages](./docs/reference/glossary.md#cloudflare-pages) — fully portable to
  any static host (Netlify, GitHub Pages, S3+CloudFront).

---

## Getting started

To preview the site on your own computer — all most contributors ever need:

```sh
pnpm install   # one-time: install dependencies
pnpm dev       # start the local site at https://lvbt.localhost
```

That's it: edit a file, see it update live. New to the project or our tools?
[`docs/tutorials/start-here.md`](./docs/tutorials/start-here.md) walks through this from scratch,
and the [glossary](./docs/reference/glossary.md) defines any unfamiliar term.

### Full setup (deploying your own copy)

`pnpm bootstrap` is a single command that takes an empty checkout all the way to a deployed site. It
runs eight phases in order — `install` → `auth` → `workspace` → `env` → `repo` → `deploy` → `domain`
→ `secrets`. Every phase checks what already exists first, so running it again is safe and an
interrupted run picks up where it stopped:

```sh
pnpm install
pnpm bootstrap   # full interactive setup; add --local-only to skip GitHub/Cloudflare
```

For what each phase does, the other flags, and how to add a phase, see the
[bootstrap reference](./docs/reference/bootstrap.md); the
[first-time-setup tutorial](./docs/tutorials/first-time-setup.md) is the hand-held version.

---

## Day-to-day commands

Run these from the repository root. They are the same commands every LVBT repository uses.

| Command            | Action                                                                             |
| ------------------ | ---------------------------------------------------------------------------------- |
| `pnpm dev`         | Local dev server at <https://lvbt.localhost>                                       |
| `pnpm build`       | Build the site to `apps/site/dist/` and its Worker to `apps/site/.wrangler/worker` |
| `pnpm preview`     | Build, then serve the site and Worker locally                                      |
| `pnpm check`       | Everything CI checks: formatting, docs, lint, types, tests, the build              |
| `pnpm check:fix`   | Apply formatting and lint fixes                                                    |
| `pnpm check-types` | Type-check the site and its scripts                                                |
| `pnpm lint`        | Lint the code, stylesheets, and brand tokens                                       |
| `pnpm format`      | Format the codebase with Prettier                                                  |
| `pnpm test`        | Run the unit tests                                                                 |
| `pnpm test:e2e`    | Run the Playwright suites, including the visual-regression sweep                   |
| `pnpm preflight`   | Re-check readiness without making changes                                          |

Commands only the site has live in [`apps/site/package.json`](./apps/site/package.json). Run them
with `pnpm -C apps/site <command>`, for example `pnpm -C apps/site test:update` to refresh the
visual-regression baselines (see [`apps/site/tests/README.md`](./apps/site/tests/README.md)) or
`pnpm -C apps/site test:install` to download the Chromium build Playwright uses.

## Editing content

The full docs live in [`docs/`](./docs/), organized so you can find things by what you're trying to
do (the [Diátaxis](https://diataxis.fr/) system). New here? Begin at
[**Start here**](./docs/tutorials/start-here.md); for everything else, the
[docs index](./docs/README.md) lists it all. Common entry points:

- [Start here](./docs/tutorials/start-here.md) — the new-contributor on-ramp
- [Glossary](./docs/reference/glossary.md) — plain-English definitions of every tool and acronym
- [Add an event](./docs/guides/add-an-event.md)
- [Add a project](./docs/guides/add-a-project.md)
- [Edit a long-form doc](./docs/guides/edit-a-long-form-doc.md)
- [Voice and tone](./docs/explanation/voice-and-tone.md) — read before drafting
- [Content collections reference](./docs/reference/content-collections.md)

### Adding an event

Events live in the LVBT Google Calendar, not in this repo. Create the event there; the site rebuilds
against the calendar hourly. For events that need long-form copy on their detail page, scaffold an
optional MDX body fragment with `pnpm -C apps/site event:new`. Full reference:
[docs/explanation/events-pipeline.md](./docs/explanation/events-pipeline.md).

## Project structure

The repository is a [Turborepo](https://turborepo.com) workspace that follows the organization's
repository standard. The site lives in `apps/site`; the root holds the repository's own tooling.

```text
apps/site/                  # The website (package @lasvegasfortransit/site)
  src/
    content/                # All editable content (MDX + JSON)
      docs/                 # Long-form essays
      pages/                # Page body copy
      event-bodies/         # Optional long-form body per event (events live in Google Calendar)
      projects/             # Project briefs
      initiatives/          # Project tags (JSON)
    layouts/                # BaseLayout, DocLayout
    components/             # Reusable UI
    pages/                  # Astro file-based routing
    lib/site.ts             # Single source of truth for org metadata (reads from PUBLIC_LVBT_*)
    styles/global.css       # Tailwind + design tokens
    content.config.ts       # Zod schemas for content collections
  public/                   # Static assets, favicon, robots.txt
  functions/                # The Worker routes (join, sign-in, account, intake APIs)
  platform/                 # The Organizing Platform code and database migrations
  scripts/bootstrap/        # The bootstrap CLI (TypeScript via tsx)
  scripts/audit/            # Build, bundle, and Worker audits
  tests/                    # Unit tests; tests/e2e holds the Playwright suites (see tests/README.md)
  astro.config.mjs          # Astro + integrations
  wrangler.jsonc            # The Cloudflare Worker that serves the site
  playwright.config.ts      # Playwright config (webserver, viewports, snapshot path)
  .env.example              # Documents PUBLIC_LVBT_* env vars
docs/                       # Repository documentation
.lvbt/                      # Commit scopes and the vendored repository standard
turbo.json                  # The tasks every package runs, in order
```

## Deployment

Pushes to `main` deploy to production at `lasvegasfortransit.org` via GitHub Actions; PRs get a
Cloudflare Pages preview URL commented on the PR. Full pipeline (build settings, env vars, rollback,
manual deploys) is documented in
[`docs/reference/deployment-pipeline.md`](./docs/reference/deployment-pipeline.md).

If anything breaks in your environment, run `pnpm preflight` first — it usually points at the
missing piece.

## CI/CD

Several workflows in [`.github/workflows/`](./.github/workflows/) build on three reusable composites
in [`.github/actions/`](./.github/actions/) (`setup-node-pnpm`, `build-site`,
`deploy-cloudflare-pages`). The ones that talk to Cloudflare:

| Workflow                      | Trigger                               | What it does                                                                   |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| `deploy-preview.yml`          | Same-repo PRs on `main`               | Build + `wrangler pages deploy --branch=<head ref>` + comment URL              |
| `deploy-production.yml`       | Pushes to `main`, `workflow_dispatch` | Build + `wrangler pages deploy --branch=main`                                  |
| `deploy-worker-preview.yml`   | Same-repo PRs, once enabled           | Uploads a version of the separate `lvbt-website-preview` Worker for comparison |
| `deploy-worker-candidate.yml` | After a successful production build   | Uploads a `main` Worker version for comparison, then cutover once enabled      |

`ci.yml` (the required `Validate` check: `pnpm check`, a dependency audit, and a secret scan, no
deploy), `audit.yml`, `audit-scheduled.yml`, `cron-rebuild.yml`, `seed-baselines.yml` and
`standard-update.yml` (daily: opens a pull request when a newer repository standard is released)
need no Cloudflare credentials. The full pipeline — every setting and the exact dashboard clicks for
each token — is in
[`docs/reference/deployment-pipeline.md`](./docs/reference/deployment-pipeline.md) and
[`docs/guides/test-the-workers-candidate.md`](./docs/guides/test-the-workers-candidate.md).

**In short:** `deploy-production.yml` and `deploy-preview.yml` both need a repository secret
`CLOUDFLARE_API_TOKEN` (an **Account · Cloudflare Pages · Edit** custom token — Cloudflare has no
ready-made template for Pages alone) and a repository variable `CLOUDFLARE_ACCOUNT_ID`. Both stay at
the repository level, not scoped to an Environment: `deploy-preview.yml`'s fork-safety job, which
declares no environment, reads them too. `deploy-worker-preview.yml` and
`deploy-worker-candidate.yml` each need their own environment-scoped `CLOUDFLARE_WORKERS_API_TOKEN`
(a narrower **Account · Workers Scripts · Edit** token) under the `worker-preview` and
`worker-candidate` GitHub environments.

## License

Site code: MIT. Editorial content (the org's vision, strategy, etc.): all rights reserved by Las
Vegans for Better Transit.
