# lasvegasfortransit.org

The website for **Las Vegans for Better Transit**, a grassroots advocacy organization fighting for world-class public transit and supportive land use in the Las Vegas Valley.

## Stack

- [Astro](https://astro.build) (static output)
- MDX content collections with Zod-typed frontmatter
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- [Public Sans](https://public-sans.digital.gov/) (USWDS font, via `@fontsource-variable/public-sans`)
- Hosted on [Cloudflare Pages](https://pages.cloudflare.com/) — fully portable to any static host (Netlify, GitHub Pages, S3+CloudFront).

---

## First-time setup: `pnpm bootstrap`

The `bootstrap` CLI is a single-command, multi-phase setup script. It walks you through everything you need to get from an empty checkout to a deployed site:

```sh
pnpm install            # one-time: install workspace deps
pnpm bootstrap          # full interactive setup
```

It runs seven phases, in order:

| Phase       | What it does                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `install`   | Verifies Node ≥ 22, pnpm ≥ 10, GitHub CLI, Cloudflare Wrangler, dig — offers to install missing tools                 |
| `auth`      | Ensures `gh` and `wrangler` are logged in                                                                             |
| `workspace` | Runs `pnpm install --frozen-lockfile` and a `pnpm build` smoke test                                                   |
| `env`       | Creates `.env.local` from `.env.example`, prompts for the live Beehiiv embed URL, donate URL, and social profile URLs |
| `repo`      | If no `origin` is set, creates a GitHub repo via `gh repo create` and pushes                                          |
| `deploy`    | If no Cloudflare Pages project exists, creates one with `wrangler pages project create` and runs the first deploy     |
| `domain`    | Verifies `lasvegasfortransit.org` and `www.…` resolve to your Pages project; prints registrar instructions if not     |

State is persisted to `.lvbt/dev-readiness.json` so re-runs can resume cleanly.

Useful flags:

```sh
pnpm preflight                       # read-only readiness check, no changes
pnpm bootstrap --resume           # skip phases that already completed
pnpm bootstrap --local-only       # run only install/workspace/env (no GitHub or Cloudflare)
pnpm bootstrap --phase env        # run a single phase by id
```

The bootstrap implementation lives at `scripts/bootstrap/`. Each phase is a small TypeScript module returning `{ success, followUpItems[] }`. Add a new phase by adding a module to `scripts/bootstrap/phases/`, registering it in `scripts/bootstrap/cold-start.ts`, and adding its id to `PhaseId` in `scripts/bootstrap/lib/types.ts`.

---

## Day-to-day commands

| Command             | Action                                                                             |
| ------------------- | ---------------------------------------------------------------------------------- |
| `pnpm dev`          | Local dev server at http://localhost:4321                                          |
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

The full docs live in [`docs/`](./docs/), structured by [Diátaxis](https://diataxis.fr/) — start at [`docs/README.md`](./docs/README.md). Common entry points:

- [Add an event](./docs/guides/add-an-event.md)
- [Add a project](./docs/guides/add-a-project.md)
- [Edit a long-form doc](./docs/guides/edit-a-long-form-doc.md)
- [Voice and tone](./docs/explanation/voice-and-tone.md) — read before drafting
- [Content collections reference](./docs/reference/content-collections.md)

### Adding an event in five steps

1. Open the repo on [GitHub](https://github.com/) or pull it locally.
2. Copy `src/content/events/_template.mdx` to a new file like `src/content/events/2026-05-15-launch-mixer.mdx`.
3. Edit the frontmatter — title, ISO 8601 date with timezone, location, summary.
4. Write the event description.
5. Commit to `main`. Cloudflare Pages auto-deploys in ~60–90 seconds.

## Project structure

```
src/
  content/                  # All editable content (MDX + JSON)
    docs/                   # Long-form essays
    pages/                  # Page body copy
    events/                 # Events
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

Three workflows in [`.github/workflows/`](./.github/workflows/), all built on three reusable composites in [`.github/actions/`](./.github/actions/) (`setup-node-pnpm`, `build-site`, `deploy-cloudflare-pages`):

| Workflow                | Trigger                               | What it does                                                      |
| ----------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| `ci.yml`                | Pull requests + non-main pushes       | Typecheck → lint:check → check:docs → build (no deploy)           |
| `deploy-preview.yml`    | Same-repo PRs on `main`               | Build + `wrangler pages deploy --branch=<head ref>` + comment URL |
| `deploy-production.yml` | Pushes to `main`, `workflow_dispatch` | Build + `wrangler pages deploy --branch=main`                     |

**Required repo secrets** (Settings → Secrets and variables → Actions):

| Name                    | Notes                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Account-scoped token with `Account.Cloudflare Pages:Edit`. Create at `https://dash.cloudflare.com/<account-id>/api-tokens` → "Edit Cloudflare Pages" template. Different token from the bootstrap's DNS token. |
| `CLOUDFLARE_ACCOUNT_ID` | Same value the bootstrap persists to `.env.local`.                                                                                                                                                             |

Scope `CLOUDFLARE_API_TOKEN` to the `production` Environment (Settings → Environments) so non-production jobs can't read it.

## License

Site code: MIT. Editorial content (the org's vision, strategy, etc.): all rights reserved by Las Vegans for Better Transit.
