# Working in this repository

Run `pnpm check` after every change. It is the same command CI runs, and a failing check names the
command that fixes it (`pnpm check:fix` repairs everything a machine can).

This repository is the Astro site for Las Vegans for Better Transit, in `apps/site`, inside a
Turborepo workspace that follows the organization's repository standard. Cloudflare Workers serves
production through explicit promotion of a saved, reviewed staging release. Changes land through
pull requests with linear history and the current `Validate` check.

New to the project (human or agent)?
[`docs/tutorials/start-here.md`](./docs/tutorials/start-here.md) orients you, and the
[`glossary`](./docs/reference/glossary.md) defines every tool and acronym used across these docs.
Contributors here are often students and junior devs — keep docs and explanations accessible (see
[`docs/standards/writing-docs.md`](./docs/standards/writing-docs.md)).

## Standard commands

Follow the shared
[developer workflow](https://github.com/LasVegasForTransit/repository-tooling/blob/main/docs/reference/developer-workflow.md)
for common setup, validation, audit and release commands. This site's `pnpm dev` starts
`https://lvbt.localhost`; `pnpm test:e2e` runs product browser acceptance against a local build.

`pnpm bootstrap` and `pnpm preflight` use the shared `@lasvegasfortransit/cli` implementation. Local
requirements are declared in `.lvbt/tooling.json`; local development requires no Cloudflare or
GitHub provider sign-in. `apps/site/platform.json` declares production requirements.
`pnpm preflight --production` reads provider readiness; a maintainer runs
`pnpm bootstrap --production` to configure what is missing. Credential setup or rotation requires a
maintainer to authorize the account, scopes, and destination. An agent may carry out that authorized
setup. Ordinary promotion uses the existing GitHub Actions credentials and needs no local Cloudflare
login. See [`docs/reference/bootstrap.md`](./docs/reference/bootstrap.md). Production normally
deploys through the explicit Promote website release workflow in GitHub Actions, which verifies a
saved staging release before it goes live. Retained recovery uses `pnpm promote --run-id <id>` with
an explicit `--expected-version <current-version>` when production lacks a shared release marker.
Direct `pnpm run deploy` is rejected by the shared release contract. An explicit request to promote
preview to production authorizes dispatching `pnpm promote` from this repository. The command
resolves the current preview in GitHub Actions, using the existing `worker-preview` Access
credentials, and publishes through `worker-candidate`. Local Cloudflare sign-in, Studio presence, a
browser session, and fresh route screenshots are not prerequisites. Existing Actions/environment
permissions and CI release checks still apply. Use `pnpm promote --run-id <id>` when the request
selects a specific reviewed staging release. Never silently substitute newest main, redispatch an
uncertain publication, or bypass a failed check. A request to inspect/review changes is separate
from a request to publish; perform the requested review without imposing a new approval on an
already authorized publication.

Every staging, PR, and production version preview URL requires the existing staff identity policy.
Trusted CI verifies private versions with a narrowly scoped Access service token. Never add a public
or Everyone bypass to make a release check pass. Production custom domains remain public.

Commands only the site has, such as `event:new` or `worker:dev`, live in `apps/site/package.json`:
run them with `pnpm -C apps/site <command>`.

## Read these first

- **[`docs/standards/commit-messages.md`](./docs/standards/commit-messages.md)** — what to put in a
  commit message, what to leave out. Read the "Don't write a refactor diary" section in particular.
- **[`docs/standards/commit-scopes.md`](./docs/standards/commit-scopes.md)** — the allowed scopes
  and why nothing else qualifies.
- **[`docs/standards/git-guidelines.md`](./docs/standards/git-guidelines.md)** — staging discipline,
  the atomic commit pattern, hooks.
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

> **Write for someone reading `git log` a year from now — not as a chronicle of how you got here.**

The biggest failure mode for an AI writing commits is treating the body as a narration of the
refactor:

```text
❌ refactor(dx): clean up validate-commit-scope.ts

Refactored for noUncheckedIndexedAccess without scattering non-null
assertions: indexOf+slice for first-line, named regex groups, .entries()
for indexed loops. A single die(...) helper replaces five
near-identical console.error+exit blocks. header.type narrows to an
AllowedType union; the stringly-typed cast is gone.
```

That is a diary entry. It tells the reader what _the author thought about_, not what _the system
does differently_.

The right shape:

```text
✅ refactor(dx): clean up validate-commit-scope.ts

Validator output and behavior unchanged; internal cleanup so future
edits start from a typed, narrowed baseline rather than scattered
assertions. No caller-visible change.
```

Or — for a genuine refactor with no caller-visible change — just the title and nothing else. Only
`feat` and `fix` commits need a body.

### Specific things to never write in a commit body

- **Internal identifier names** (`createSubscribeMiddleware`, `die`, `firstLineOf`, `PHASE_BY_ID`)
  unless they're a public exported API.
- **TypeScript / language mechanics** (narrowing, union types, type guards, `as`, non-null
  assertions, generics, `noUncheckedIndexedAccess`).
- **Shell / regex idioms** (`here-doc`, `IFS=$'\\t'`, named capture groups, `Promise.all` over
  `spawnSync`). Describe the resulting behavior, not the technique.
- **Refactor mechanics phrased as outcomes** ("collapses X into Y", "replaces A with B", "switched X
  to Y"). The diff shows replacement; the message should say _what works differently_ or — if
  nothing does — let the title carry the change.
- **Comparison to prior implementation** ("the old code did X; now we do Y"). Say what the code does
  now.
- **Test counts, coverage percentages, lint warning counts.** Mention what scenarios are now
  covered, not the numbers.

### What does belong

- Behavior changes a maintainer or visitor would notice.
- Bugs fixed, with root cause.
- Performance wins, with numbers ("Lighthouse LCP 3.2 s → 1.4 s").
- Contract changes (API endpoints, env-var keys, breaking changes).
- Removals, with the reason.

Full spec and more examples in [`commit-messages.md`](./docs/standards/commit-messages.md).

---

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
- Cloudflare Workers in production, with protected staging updated from main and explicit release
  promotion
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
- Membership intake: Google Form → Cloudflare Worker → Beehiiv + Notion — see
  [`docs/reference/membership-intake.md`](./docs/reference/membership-intake.md).
- Transit news intake: three ways to push articles into a Notion database (pnpm script, Claude Code
  skill, public Notion form + Cloudflare enrichment) — see
  [`docs/guides/add-transit-news.md`](./docs/guides/add-transit-news.md) and
  [`docs/reference/transit-news-pipeline.md`](./docs/reference/transit-news-pipeline.md).

---

## Related

- [`docs/tutorials/start-here.md`](./docs/tutorials/start-here.md) — new-contributor on-ramp
- [`docs/reference/glossary.md`](./docs/reference/glossary.md) — tools & acronyms defined
- [`docs/standards/writing-docs.md`](./docs/standards/writing-docs.md) — keep docs accessible
- [`docs/standards/commit-messages.md`](./docs/standards/commit-messages.md)
- [`docs/standards/commit-scopes.md`](./docs/standards/commit-scopes.md)
- [`docs/standards/git-guidelines.md`](./docs/standards/git-guidelines.md)
- [`docs/explanation/events-pipeline.md`](./docs/explanation/events-pipeline.md)
- [`README.md`](./README.md)
