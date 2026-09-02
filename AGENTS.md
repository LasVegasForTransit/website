# Working in this repository

Run `pnpm check` after every change. It is the same command CI runs, and a failing check names the
command that fixes it (`pnpm check:fix` repairs everything a machine can).

## Standard commands

Every LVBT repository answers to the same commands:

| Command               | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `pnpm bootstrap`      | Install dependencies, wire git hooks, and run preflight    |
| `pnpm preflight`      | Confirm the machine can build and deploy this repository   |
| `pnpm check`          | Format, docs, shape rules, lint, types, tests, repo checks |
| `pnpm check:fix`      | Apply formatting and lint fixes                            |
| `pnpm build`          | Build every package                                        |
| `pnpm test`           | Run every package's tests                                  |
| `pnpm run deploy`     | Build, then `wrangler deploy` every app (deployable repos) |
| `turbo gen workspace` | Scaffold a new package or app                              |

## Create GitHub issues and pull requests

Use the mandatory `github-contribution` skill from the `lvbt-contributions` plugin whenever a user
authorizes creating an issue or pull request. It carries the organization checklist, readable
templates, and the only approved creation helper:

```bash
node node_modules/@lvbt/cli/plugins/lvbt-contributions/scripts/github-create.mjs issue \
  --type bug|feature --title <title> --body-file <file>
node node_modules/@lvbt/cli/plugins/lvbt-contributions/scripts/github-create.mjs pr \
  --title <title> --body-file <file> --base main
```

Preview with `--dry-run --json` and inspect the complete Markdown before creating anything. Do not
call `gh issue create`, `gh pr create`, equivalent `gh api` routes, or connector creation tools
directly.

## Commit messages

Subjects are conventional: `type(scope): description`, at most 72 characters. Scopes are optional
and come only from [`.lvbt/commit-scopes.txt`](.lvbt/commit-scopes.txt). Omit the scope when a
change crosses boundaries; never invent one for a feature, file, task, or role.

## The repository standard

Lint, format, TypeScript, and test settings extend the `@lvbt/*` packages from
`LasVegasForTransit/repository-tooling`. Change a shared rule there, not here.

## Read these first

- **[`docs/standards/commit-messages.md`](./docs/development/reference/commit-messages.md)** — what
  to put in a commit message, what to leave out. Read the "Don't write a refactor diary" section in
  particular.
- **[`docs/standards/commit-scopes.md`](./docs/development/reference/commit-scopes.md)** — the four
  allowed scopes and why nothing else qualifies.
- **[`docs/standards/git-guidelines.md`](./docs/development/reference/git-guidelines.md)** — staging
  discipline, the atomic commit pattern, hooks.
- [`.lvbt/commit-scopes.txt`](.lvbt/commit-scopes.txt) — source of truth for the scope list (what
  the commit-msg hook reads).

The hooks under `.githooks/` come from `@lvbt/cli` and enforce most of this automatically.

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

Or — for a genuine refactor with no caller-visible change — just the title and nothing else. The
density rule allows that.

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

Full spec and more examples in
[`commit-messages.md`](./docs/development/reference/commit-messages.md).

---

## Commit format quick reference

```text
type(scope)?: brief description (≤ 72 chars, imperative mood)

Body — optional for chore/refactor/docs/test/perf when density ≤ 10;
required for feat/fix. Wrap at 72 chars.

Co-Authored-By: <name> <email>   (optional trailer)
```

**Allowed types:** `feat fix docs refactor test chore perf`. `style` and `diag` are retired (use
`chore`).

**Allowed scopes:** `content ci docs dx`, or empty. No page slugs, no component names, no
short-lived feature names, no `deps`, no vendor tags. See
[`commit-scopes.md`](./docs/development/reference/commit-scopes.md) for rationale.

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

## Stack quick map

- Astro 4 + Tailwind v4 (MDX content collections under `src/content/`)
- Cloudflare Pages (`pnpm dev` starts Astro + a local Wrangler Pages Functions server, with Astro
  proxying `/api/*` to it)
- pnpm, Node ≥ 24.18.0
- Playwright for tests and ad-hoc screenshots
- `scripts/bootstrap/` is the interactive setup CLI (`pnpm bootstrap`, `pnpm preflight`)
- `scripts/audit/` is the CI/release audit baseline
- `scripts/validation/git/` is the commit-message validator
- `src/lib/site.ts` is the runtime config object (org name, URLs, social handles)
- Events are sourced from a public Google Calendar at build time — see
  [`docs/explanation/events-pipeline.md`](./docs/product/explanation/events-pipeline.md). To add an
  event, create it in GCal; for long-form body copy, scaffold a fragment under
  `src/content/event-bodies/` via `pnpm event:new`.
- Newsletter issues are pulled from the Beehiiv RSS feed at build time and listed on `/newsletter`,
  linking out to Beehiiv (issues are not hosted here) — see
  [`src/lib/newsletter-loader.ts`](./apps/site/src/lib/newsletter-loader.ts). Feed and home URLs
  come from `PUBLIC_LVBT_NEWSLETTER_FEED_URL` / `PUBLIC_LVBT_NEWSLETTER_URL`.
- Membership intake: Google Form → Cloudflare Pages Function → Beehiiv + Notion — see
  [`docs/reference/membership-intake.md`](./docs/operations/reference/membership-intake.md).
- Transit news intake: three ways to push articles into a Notion database (pnpm script, Claude Code
  skill, public Notion form + Cloudflare enrichment) — see
  [`docs/guides/add-transit-news.md`](./docs/product/how-to/add-transit-news.md) and
  [`docs/reference/transit-news-pipeline.md`](./docs/operations/reference/transit-news-pipeline.md).

---

## Related

- [`docs/tutorials/start-here.md`](./docs/development/tutorials/start-here.md) — new-contributor
  on-ramp
- [`docs/reference/glossary.md`](./docs/development/reference/glossary.md) — tools & acronyms
  defined
- [`docs/standards/writing-docs.md`](./docs/development/reference/writing-docs.md) — keep docs
  accessible
- [`docs/standards/commit-messages.md`](./docs/development/reference/commit-messages.md)
- [`docs/standards/commit-scopes.md`](./docs/development/reference/commit-scopes.md)
- [`docs/standards/git-guidelines.md`](./docs/development/reference/git-guidelines.md)
- [`docs/explanation/events-pipeline.md`](./docs/product/explanation/events-pipeline.md)
- [`README.md`](./README.md)
