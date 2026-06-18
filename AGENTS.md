# AGENTS.md

Guidance for AI agents (Claude Code, Codex, Gemini, etc.) working in this repo.

This is a single Astro site for Las Vegans for Better Transit, deployed to Cloudflare Pages. Solo project, no PR workflow, no force-push expectations — just careful local commits.

New to the project (human or agent)? [`docs/tutorials/start-here.md`](./docs/tutorials/start-here.md) orients you, and the [`glossary`](./docs/reference/glossary.md) defines every tool and acronym used across these docs. Contributors here are often students and junior devs — keep docs and explanations accessible (see [`docs/standards/writing-docs.md`](./docs/standards/writing-docs.md)).

---

## Read these first

- **[`docs/standards/commit-messages.md`](./docs/standards/commit-messages.md)** — what to put in a commit message, what to leave out. Read the "Don't write a refactor diary" section in particular.
- **[`docs/standards/commit-scopes.md`](./docs/standards/commit-scopes.md)** — the four allowed scopes and why nothing else qualifies.
- **[`docs/standards/git-guidelines.md`](./docs/standards/git-guidelines.md)** — staging discipline, the atomic commit pattern, hooks.
- **[`allowed-scopes.txt`](./allowed-scopes.txt)** — source of truth for the scope list (what the commit‑msg hook reads).

The hooks under [`.githooks/`](./.githooks/) enforce most of this automatically. The repo's `prepare` script wires `core.hooksPath` to `.githooks` on `pnpm install`.

---

## Commit messages: the rule you will be tempted to break

> **Write for someone reading `git log` a year from now — not as a chronicle of how you got here.**

The biggest failure mode for an AI writing commits is treating the body as a narration of the refactor:

```
❌ refactor(dx): clean up validate-commit-scope.ts

Refactored for noUncheckedIndexedAccess without scattering non-null
assertions: indexOf+slice for first-line, named regex groups, .entries()
for indexed loops. A single die(...) helper replaces five
near-identical console.error+exit blocks. header.type narrows to an
AllowedType union; the stringly-typed cast is gone.
```

That is a diary entry. It tells the reader what _the author thought about_, not what _the system does differently_.

The right shape:

```
✅ refactor(dx): clean up validate-commit-scope.ts

Validator output and behavior unchanged; internal cleanup so future
edits start from a typed, narrowed baseline rather than scattered
assertions. No caller-visible change.
```

Or — for a genuine refactor with no caller-visible change — just the title and nothing else. The density rule allows that.

### Specific things to never write in a commit body

- **Internal identifier names** (`createSubscribeMiddleware`, `die`, `firstLineOf`, `PHASE_BY_ID`) unless they're a public exported API.
- **TypeScript / language mechanics** (narrowing, union types, type guards, `as`, non-null assertions, generics, `noUncheckedIndexedAccess`).
- **Shell / regex idioms** (`here-doc`, `IFS=$'\\t'`, named capture groups, `Promise.all` over `spawnSync`). Describe the resulting behavior, not the technique.
- **Refactor mechanics phrased as outcomes** ("collapses X into Y", "replaces A with B", "switched X to Y"). The diff shows replacement; the message should say _what works differently_ or — if nothing does — let the title carry the change.
- **Comparison to prior implementation** ("the old code did X; now we do Y"). Say what the code does now.
- **Test counts, coverage percentages, lint warning counts.** Mention what scenarios are now covered, not the numbers.

### What does belong

- Behavior changes a maintainer or visitor would notice.
- Bugs fixed, with root cause.
- Performance wins, with numbers ("Lighthouse LCP 3.2 s → 1.4 s").
- Contract changes (API endpoints, env-var keys, breaking changes).
- Removals, with the reason.

Full spec and more examples in [`commit-messages.md`](./docs/standards/commit-messages.md).

---

## Commit format quick reference

```
type(scope)?: brief description (≤ 72 chars, imperative mood)

Body — optional for chore/refactor/docs/test/perf when density ≤ 10;
required for feat/fix. Wrap at 72 chars.

Co-Authored-By: <name> <email>   (optional trailer)
```

**Allowed types:** `feat fix docs refactor test chore perf`. `style` and `diag` are retired (use `chore`).

**Allowed scopes:** `content ci docs dx`, or empty. No page slugs, no component names, no short-lived feature names, no `deps`, no vendor tags. See [`commit-scopes.md`](./docs/standards/commit-scopes.md) for rationale.

---

## Workflow expectations

- **Don't push.** This repo runs a single-branch solo workflow with no remote PR ceremony. Edit and commit locally. Don't force-push, don't open PRs, don't auto-amend without explicit instruction.
- **Don't `git add .` / `-A` / `*`.** Stage explicit paths.
- **Don't bypass the hooks** with `--no-verify`. If a hook fails, fix what it reports.
- **Don't `git reset --hard`** ever. Use `git restore --source=HEAD -- path` or `git stash --include-untracked` instead.

Pre-approval to commit applies only when the user has explicitly said "commit" / "commit when done" / similar in the current task. Otherwise, surface the proposed message and wait.

---

## Stack quick map

- Astro 4 + Tailwind v4 (MDX content collections under `src/content/`)
- Cloudflare Pages (`pnpm dev` runs Astro + `wrangler pages dev --proxy`)
- pnpm, Node ≥ 22.12
- Playwright for tests and ad-hoc screenshots
- `scripts/bootstrap/` is the interactive setup CLI (`pnpm bootstrap`, `pnpm preflight`)
- `scripts/audit/` is the CI/release audit baseline
- `scripts/validation/git/` is the commit-message validator
- `src/lib/site.ts` is the runtime config object (org name, URLs, social handles)
- Events are sourced from a public Google Calendar at build time — see [`docs/explanation/events-pipeline.md`](./docs/explanation/events-pipeline.md). To add an event, create it in GCal; for long-form body copy, scaffold a fragment under `src/content/event-bodies/` via `pnpm event:new`.
- Membership intake: Google Form → Cloudflare Pages Function → Beehiiv + Notion — see [`docs/reference/membership-intake.md`](./docs/reference/membership-intake.md).
- Transit news intake: three ways to push articles into a Notion database (pnpm script, Claude Code skill, public Notion form + Cloudflare enrichment) — see [`docs/guides/add-transit-news.md`](./docs/guides/add-transit-news.md) and [`docs/reference/transit-news-pipeline.md`](./docs/reference/transit-news-pipeline.md).

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
