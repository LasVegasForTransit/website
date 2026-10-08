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
- Hosted on Cloudflare Workers with static assets and server routes.

---

## Getting started

To preview the site on your own computer — all most contributors ever need:

```sh
pnpm bootstrap # one-time: dependencies, hooks, and missing local settings
pnpm dev       # start the local site at https://lvbt.localhost
```

That's it: edit a file, see it update live. New to the project or our tools?
[`docs/tutorials/start-here.md`](./docs/tutorials/start-here.md) walks through this from scratch,
and the [glossary](./docs/reference/glossary.md) defines any unfamiliar term.

### Setup and production readiness

`pnpm bootstrap` prepares a local checkout and preserves existing local environment files. Empty
Beehiiv or Notion integration settings produce warnings; page and content work needs no provider
login. The [first-time setup tutorial](./docs/tutorials/first-time-setup.md) covers clone,
bootstrap, development, checks, and the pull request path.

```sh
pnpm preflight              # read local readiness without changing anything
pnpm preflight --production # read the existing production platform requirements
```

Production setup is a separate maintainer operation, `pnpm bootstrap --production`. It uses
[`apps/site/platform.json`](./apps/site/platform.json) and never publishes a website release.
Reviewed changes merge through pull requests, update protected staging, and reach the public site
only through explicit promotion. See the [bootstrap reference](./docs/reference/bootstrap.md).

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
  platform.json             # Production resources and credentials checked by the shared CLI
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

Pushes to `main` update `preview.lasvegasfortransit.org` behind Cloudflare Access. Explicit
promotion publishes the selected saved release at `lasvegasfortransit.org`. Same-repository PRs
receive independent, protected Worker preview URLs. Full pipeline (build settings, env vars,
rollback, manual deploys) is documented in
[`docs/reference/deployment-pipeline.md`](./docs/reference/deployment-pipeline.md).

If anything breaks in your environment, run `pnpm preflight` first — it usually points at the
missing piece.

## CI/CD

Several workflows in [`.github/workflows/`](./.github/workflows/) build on three reusable composites
in [`.github/actions/`](./.github/actions/) (`setup-node-pnpm`, `build-site`,
`deploy-cloudflare-pages`). The ones that talk to Cloudflare:

| Workflow                                                | Trigger                                        | What it does                                        |
| ------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| `deploy-production.yml` (Deploy staging)                | Main pushes and manual dispatch                | Save a release and verify protected staging         |
| `deploy-worker-preview.yml`                             | Same-repository PR updates                     | Verify and comment an independent protected preview |
| `deploy-worker-candidate.yml` (Promote website release) | Explicit selection of a successful staging run | Publish the saved release after candidate checks    |

`ci.yml` (the required `Validate` check runs `pnpm check`, including the required uncached
production dependency audit and full-history secret scan), `audit.yml`, `audit-scheduled.yml`,
`cron-rebuild.yml`, `seed-baselines.yml` and `standard-update.yml` (daily: opens a pull request when
a newer repository standard is released) need no Cloudflare credentials. The full pipeline — every
setting and the exact dashboard clicks for each token — is in
[`docs/reference/deployment-pipeline.md`](./docs/reference/deployment-pipeline.md) and
[`docs/guides/test-the-workers-candidate.md`](./docs/guides/test-the-workers-candidate.md).

Workers credentials are scoped to the `worker-preview` and `worker-candidate` GitHub environments.
The preview environment also needs a Cloudflare Access service token. Credentials remain outside
release artifacts; the account ID is a repository variable. See the linked pipeline reference for
exact secret names and review/promotion steps.

## License

Site code: MIT. Editorial content (the org's vision, strategy, etc.): all rights reserved by Las
Vegans for Better Transit.
