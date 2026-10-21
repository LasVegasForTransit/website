# Working in this repository

Contributors and agents use these rules when changing this repository. Run `pnpm check` after every
change. CI runs the same checks. Use `pnpm check:fix` for fixes the tools can apply, then read and
resolve any remaining failures.

This repository is the Astro site for Las Vegans for Better Transit, in `apps/site`, inside a
Turborepo workspace that follows the organization's repository standard. Cloudflare Workers serves
production through explicit promotion of a saved, reviewed staging release. Changes land through
pull requests with linear history and the current `Validate` check.

Start with [`docs/tutorials/start-here.md`](./docs/tutorials/start-here.md) for setup. The
[`glossary`](./docs/reference/glossary.md) defines unfamiliar terms. Write for contributors who may
be new to the stack. Explain the reason for a choice as well as the steps (see
[`docs/standards/writing-docs.md`](./docs/standards/writing-docs.md)).

## Standard commands

Follow the shared
[developer workflow](https://github.com/LasVegasForTransit/repository-tooling/blob/main/docs/reference/developer-workflow.md)
for common setup, validation, audit and release commands. This site's `pnpm dev` starts
`https://lvbt.localhost`; `pnpm test:e2e` runs product browser acceptance against a local build.

`pnpm bootstrap` sets up local tools. `pnpm preflight` checks them. Both use the shared
`@lasvegasfortransit/cli` and read `.lvbt/tooling.json`. Local development needs no Cloudflare or
GitHub sign-in. Site-specific commands live in `apps/site/package.json`.

Production setup is separate. `apps/site/platform.json` declares the requirements.
`pnpm preflight --production` checks provider readiness. A maintainer authorizes the account,
scopes, and destination before an agent runs `pnpm bootstrap --production` or rotates credentials.
See [bootstrap and preflight](./docs/reference/bootstrap.md).

Production publication uses **Promote website release** in GitHub Actions. It verifies and publishes
a saved staging build. An explicit request to promote preview to production authorizes
`pnpm promote` here. The command resolves the current preview through GitHub Actions and uses the
existing `worker-preview` Access credentials to publish through `worker-candidate`.

Ordinary promotion needs no local Cloudflare sign-in, Studio session, or new route screenshots.
Actions permissions and release checks still apply. Use `pnpm promote --run-id <id>` when the user
selects a specific reviewed staging build. Recovery also needs
`--expected-version <current-version>` when production has no shared release marker. Direct
`pnpm run deploy` is rejected.

Never substitute the newest main build for the selected build. Reconcile provider versions before
retrying an uncertain publication. Never bypass a failed check. A review request does not authorize
publication. Do not add another approval requirement after the user has authorized publication.

Commands only the site has, such as `event:new` or `worker:dev`, live in `apps/site/package.json`:
run them with `pnpm -C apps/site <command>`.

## Read these first

- **[`docs/standards/commit-messages.md`](./docs/standards/commit-messages.md)** — what to put in a
  commit message, what to leave out. Read the "Don't write a refactor diary" section in particular.
- **[`docs/standards/commit-scopes.md`](./docs/standards/commit-scopes.md)** — the allowed scopes
  and why nothing else qualifies.
- **[`docs/standards/git-guidelines.md`](./docs/standards/git-guidelines.md)** — staging discipline,
  explicit staging, hooks, and safe undo commands.
- **[`.lvbt/commit-scopes.txt`](./.lvbt/commit-scopes.txt)** — source of truth for the scope list
  (what the commit‑msg hook reads).

The hooks under [`.githooks/`](./.githooks/) enforce most of this automatically. The repo's
`prepare` script wires `core.hooksPath` to `.githooks` on `pnpm install`.

## Commit messages

Subjects are conventional: `type(scope): description`, at most 72 characters. Scopes are optional
and come only from [`.lvbt/commit-scopes.txt`](.lvbt/commit-scopes.txt). Omit the scope when a
change crosses boundaries; never invent one for a feature, file, task, or role.

## The repository standard

Lint, format, TypeScript, and test settings extend the `@lasvegasfortransit/*` packages from
`LasVegasForTransit/repository-tooling`. Change a shared rule there, not here. The standard's
release is vendored in `.lvbt/web-platform/` and updated by the `Standard update` workflow or
`pnpm standards:update`; never edit that directory by hand.

---

## Commit messages: the rule you will be tempted to break

Write for a maintainer reading `git log` a year later. Explain the result and the reason for the
choice. The diff already shows which helpers moved or variables changed.

### Specific things to never write in a commit body

Leave out private phase names, unexplained task IDs, internal identifier lists, language mechanics,
shell tricks, test totals, and lists of silenced warnings. Name a public API when its contract
changes. Describe the scenarios that tests protect.

### What does belong

Explain changed behavior, a bug's cause, a measured improvement, a changed public setting or API, or
the reason for a removal. Include a limitation when it affects use or operation. A local test result
does not establish production behavior.

Follow [commit-messages.md](./docs/standards/commit-messages.md) for examples and body requirements.

## Commit format quick reference

```text
type(scope)?: brief description (≤ 72 chars, imperative mood)

Body — required for feat/fix, otherwise whenever the title alone is
ambiguous. Wrap at 72 chars.

Co-Authored-By: <model> <email>   (required when an agent commits)
```

**Allowed types:** `build chore docs feat fix perf refactor revert style test`. `ci` is deprecated;
use `chore` for workflow changes.

**Allowed scopes:** `site content functions docs dx`, or empty. No page slugs, no component names,
no short-lived feature names, no `deps`, no vendor tags. See
[`commit-scopes.md`](./docs/standards/commit-scopes.md) for rationale.

---

## Workflow expectations

Operator procedures are part of delivery. A change to setup, permissions, credentials, migrations,
deployment, provider behavior, or recovery must update the relevant operator guide in the same
change. Document prerequisites, exact steps, expected results, verification, and failure recovery so
a new maintainer needs no chat history. Keep private planning, credentials, member data, and
detailed execution receipts out of public docs. Follow
[Writing docs](docs/standards/writing-docs.md).

- Prefix fresh clones and worktrees with `GIT_LFS_SKIP_SMUDGE=1` to avoid unnecessary screenshot
  downloads. Follow the [screenshot guide](apps/site/tests/README.md#first-time-setup) when images
  are needed.
- Work on a branch and use a pull request for every change to `main`. Never force-push or delete the
  default branch.
- **Don't `git add .` / `-A` / `*`.** Stage explicit paths.
- **Don't bypass the hooks** with `--no-verify`. If a hook fails, fix what it reports.
- **Don't `git reset --hard`** ever. Use `git restore --source=HEAD -- path` or
  `git stash --include-untracked` instead.

Pre-approval to commit applies only when the user has explicitly said "commit" / "commit when done"
/ similar in the current task. Otherwise, surface the proposed message and wait.

## Create GitHub issues and pull requests

Use the mandatory `github-contribution` skill from the pinned `lvbt-contributions` plugin whenever a
user authorizes creating an issue or pull request. It carries the organization checklist, readable
templates, and the only approved creation helper:

```bash
node node_modules/@lasvegasfortransit/cli/plugins/lvbt-contributions/scripts/github-create.mjs issue \
  --type bug|feature --title <title> --body-file <file>
node node_modules/@lasvegasfortransit/cli/plugins/lvbt-contributions/scripts/github-create.mjs pr \
  --title <title> --body-file <file> --base main
```

Preview with `--dry-run --json`, remove every bracketed prompt, and inspect the complete visible
Markdown before creating anything. Do not call `gh issue create`, `gh pr create`, equivalent
`gh api` routes, or connector creation tools directly. Humans use the native organization issue
forms and pull request template; agents use the same visible structure. There are no hidden body
markers or GitHub-side prose checks.

---

## Stack quick map

- Astro 7 + Tailwind v4 (MDX content collections under `apps/site/src/content/`)
- Cloudflare Workers in production, with explicitly dispatched protected staging from main and
  explicit release promotion
- pnpm 11.25.0 and Node 24.20 or newer in the 24.x line, run through Turborepo
- Playwright for tests and ad-hoc screenshots
- `.lvbt/tooling.json` declares local setup; `apps/site/platform.json` declares production setup
  (`pnpm bootstrap`, `pnpm preflight`, and their explicit `--production` mode)
- `apps/site/scripts/audit/` is the CI/release audit baseline
- `apps/site/src/lib/site.ts` is the runtime config object (org name, URLs, social handles)
- Events are sourced from a public Google Calendar at build time — see
  [`docs/explanation/events-pipeline.md`](./docs/explanation/events-pipeline.md). To add an event,
  create it in GCal; for long-form body copy, scaffold a fragment under
  `apps/site/src/content/event-bodies/` via `pnpm -C apps/site event:new`.
- Newsletter issues are pulled from the Beehiiv RSS feed at build time and listed on `/newsletter`,
  linking out to Beehiiv (issues are not hosted here) — see
  [`apps/site/src/lib/newsletter-loader.ts`](./apps/site/src/lib/newsletter-loader.ts). Feed and
  home URLs come from `PUBLIC_LVBT_NEWSLETTER_FEED_URL` / `PUBLIC_LVBT_NEWSLETTER_URL`.
- Week Without Driving is served at `lvwwd.org`, its own site in the `week-without-driving` repo on
  the `lvwwd` Worker; this repo only redirects `/wwd`, `/wwd/` and `/week-without-driving` there —
  see
  [`docs/reference/week-without-driving-site.md`](./docs/reference/week-without-driving-site.md).
- Membership intake: the website and supported forms save a person record in D1. Staff use the
  Welcome flow, and scheduled jobs deliver newsletter choices to Beehiiv — see
  [`docs/reference/membership-intake.md`](./docs/reference/membership-intake.md).
- Transit news intake: three ways to push articles into a Notion database (pnpm script, Claude Code
  skill, public Notion form + Cloudflare enrichment) — see
  [`docs/guides/add-transit-news.md`](./docs/guides/add-transit-news.md) and
  [`docs/reference/transit-news-pipeline.md`](./docs/reference/transit-news-pipeline.md).

---

## Related

- [`docs/tutorials/start-here.md`](./docs/tutorials/start-here.md) — first contributor task
- [`docs/reference/glossary.md`](./docs/reference/glossary.md) — tools & acronyms defined
- [`docs/standards/writing-docs.md`](./docs/standards/writing-docs.md) — keep docs accessible
- [`docs/standards/commit-messages.md`](./docs/standards/commit-messages.md)
- [`docs/standards/commit-scopes.md`](./docs/standards/commit-scopes.md)
- [`docs/standards/git-guidelines.md`](./docs/standards/git-guidelines.md)
- [`docs/explanation/events-pipeline.md`](./docs/explanation/events-pipeline.md)
- [`README.md`](./README.md)
