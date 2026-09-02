# Commit Message Standards

> **Authoritative reference for writing commit messages in the LVBT website repo.** Adapted from the
> lovelace platform standards, scaled down to a single Astro site.

This page is the rulebook for what to type after `git commit`. It exists because commit messages are
the permanent record of why code exists: the diff shows the mechanics (the exact lines that
changed); the message explains everything else. Someone reading `git log` (the running history of
every commit) a year from now has nothing else to go on.

---

## Quick format reference

```text
type(scope): brief description

Optional body explaining why, wrapped at 72 chars.

Optional footer (issue refs, co-authors, BREAKING CHANGE).
```

**Constraints:**

- Title under 72 characters (displays in `git log --oneline`, email clients, GitHub UI).
- Imperative mood: "Add newsletter form", not "Added newsletter form".
- Specific: "Fix header observer under strict CSP" beats "Fix bug".
- Proper nouns and initialisms capitalized — API, CSP, MDX, OAuth, Astro, Cloudflare, Pages,
  Beehiiv. Names are not lowercase words.

---

## Message anatomy

### Title (required)

`type(scope): description` — the only required part. This is the **Conventional Commits** format: a
widely-used convention where every commit title starts with a `type` (like `feat` or `fix`), an
optional `(scope)`, then a short summary — e.g. `feat(content): add about page`. It's validated by
the commit‑msg hook: a script Git runs automatically when you commit, which rejects the commit if
the message breaks the rules below (see [git-guidelines.md](./git-guidelines.md#hook-overview)).

### Body (required for `feat` and `fix`; conditional otherwise)

Separated from title by a blank line, wrapped at 72 characters. This is where context lives — _why_
the change was necessary, what alternatives existed, what trade‑offs were made.

- **`feat` and `fix` commits:** Always include a body. The hook enforces this.
- **Other types (`chore`, `refactor`, `docs`, `test`, `perf`):** Body required when the change
  density `(files × 2) + (lines × 0.1)` exceeds 10. This formula is just a rough "how big is this
  change?" score — bigger changes (more files, more lines) need a sentence of explanation; a
  one-line tweak doesn't. Single‑line fixes are exempt.
- Body lines ≤72 chars. Trailers (`Co-Authored-By:`, `Signed-off-by:`, `Reviewed-by:`, `Acked-by:`)
  are exempt from the length cap.

### Footer (optional)

- `BREAKING CHANGE: …` — backwards‑incompatible behavior change.
- `Fixes #123` / `Closes #456` — closes an issue when merged.
- `Related to #789` — references without closing.
- `Co-Authored-By: Name <email>` — credit collaborators.

---

## Allowed types

| Type       | Purpose                                                              | Body expectations                                         |
| ---------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| `feat`     | New functionality the site didn't have before                        | What it does for visitors, why it was needed              |
| `fix`      | Broken behavior corrected                                            | What was broken, root cause, how the fix addresses it     |
| `refactor` | Code restructured without behavior change                            | Why restructuring (bugs, clarity, enabling future work)   |
| `docs`     | Repo documentation under `docs/` (README, standards, runbooks)       | Usually self‑explanatory; explain when non‑obvious        |
| `test`     | Test additions or modifications                                      | What scenarios are now covered                            |
| `chore`    | Maintenance (dependencies, build/CI config, formatting, hooks, deps) | Operational rationale when density warrants               |
| `perf`     | Performance improvements                                             | Before/after metrics when possible, bottleneck identified |

> `style` is **not** valid. Prettier and the pre‑commit hook enforce formatting automatically, so a
> dedicated style commit should never be needed. Use `chore` if formatting slips through.

---

## Scopes

Only four scopes are valid: `content`, `ci`, `docs`, `dx`. See
[commit-scopes.md](./commit-scopes.md) for the full list and rationale. Empty scope is the default
for everything else (`feat: add newsletter form`).

Do **not** invent ad‑hoc scopes for page slugs, components, short‑lived features, dep bumps, or
vendor names. The commit‑msg hook rejects anything outside the curated list.

---

## Write for the public log

A future reader has no Slack context, no PR description, no issue tracker access. Write each message
as if it ships in a public changelog.

### The test

Before mentioning any technical detail in a commit message, ask:

**"If I'm reading this commit in `git log` a year from now, can I do something different because of
this information?"**

- ✅ YES → it's behavior, capability, or breakage. Include it. (**Behavior** = something the site or
  a tool now does differently; **capability** = something it can now do that it couldn't;
  **breakage** = something that used to work and no longer does, or an interface other code depended
  on that changed.)
- ❌ NO → it's refactor mechanics, internal identifiers, or a story about how the author got there.
  Cut it.

### Don't write a refactor diary

The single biggest failure mode is treating the body as a narration of _how the author thought about
the change_ instead of _what changed about the system_. Common offenders, all forbidden:

| ❌ Refactor diary                                                                                                                                        | ✅ Effect on the system                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| "Refactored for `noUncheckedIndexedAccess` without scattering non-null assertions; used `indexOf+slice`, named regex groups, and `.entries()` for loops" | "Validator now narrows types properly; no more unsafe casts in the commit-msg check"                |
| "Extracted `die(...lines): never` helper, collapses five `console.error`+`process.exit` blocks"                                                          | (delete — internal cleanup, no caller-visible change)                                               |
| "Renamed `firstLine` → `firstLineOf`; replaced `split('\\n')[0]!` with `indexOf+slice`"                                                                  | (delete — same external behavior)                                                                   |
| "Single `git log --format='%h%x09%s'` parsed via `read` instead of per-commit `git log -1 + git rev-parse --short`"                                      | "Pre-push commit validation no longer spawns two git processes per commit; large pushes are faster" |
| "Collapses `PHASE_ORDER`, `PHASE_INFO`, and `isLocalPhase`'s string-eq cascade into a single `PHASES` array with derived lookups"                        | "Adding a bootstrap phase now touches one definition instead of three; type-checked end to end"     |
| "Replaces inline `console.error` block with helper"                                                                                                      | (delete)                                                                                            |
| "Switched `spawnSync` to `spawn` + `Promise.all`"                                                                                                        | "`pnpm audit:baseline` now runs the four read-only audit tools in parallel, ~3 s faster"            |

The right-hand column is what a maintainer cares about: **what changed about the system, what they
can rely on now, what they no longer need to worry about.** The left column is the author's
chronicle.

### What never belongs in a commit message

- **Internal identifier names** (`createSubscribeMiddleware`, `die`, `firstLineOf`, `PHASE_BY_ID`,
  `useAuth`) unless they are a public, exported API surface.
- **TypeScript / language mechanics** (narrowing, union types, `as`, non-null assertions, type
  guards, generics) — these are the author's tools, not the reader's concern.
- **Shell / regex idioms** (`here-doc`, `IFS=$'\\t'`, named capture groups, `Promise.all`) —
  describe the resulting behavior, not the technique.
- **Refactor mechanics phrased as outcomes** ("collapses X into Y", "replaces A with B", "switched X
  to Y"). The diff shows what was replaced; the message should say _what works differently_, or — if
  nothing works differently — let the title carry the change and skip the body.
- **Comparison to prior implementation** ("the old code did X; now we do Y"). Say what the code does
  now.
- **Test counts, coverage percentages, lint warning counts.** Mention what scenarios are now
  covered, not how many tests exist.

### What does belong

- **What capability changed for someone using the site** ("visitors can subscribe to the newsletter
  without leaving the page").
- **What broke and why** ("strict CSP dropped `script-src 'unsafe-inline'`, which silently killed
  the inline script that set `data-stuck` on the header").
- **What's faster, with numbers when possible** ("Lighthouse LCP from 3.2 s to 1.4 s by deferring
  third-party fonts").
- **What contract changed** ("`/api/subscribe` now rate-limits at 5 requests/min per IP").
- **What's been removed and why** ("dropped the Beehiiv iframe — couldn't style it, forced a
  third-party CSP allowance, and the form-driven flow makes it unnecessary").
- **Breaking changes**, called out with `!:` and a `BREAKING CHANGE:` footer.

### Refactor commits especially

`refactor:` commits are the easiest place to slip into diary mode because no behavior changed. The
trap is filling the body with mechanics ("extracted helper", "renamed variables", "consolidated
three arrays").

The fix: lead with the _reason_ the refactor matters to a future reader, then describe the _new
shape_ in one or two sentences. If neither of those is interesting (it's just code hygiene), the
title alone is enough — skip the body. The density rule lets you.

```text
❌ refactor(dx): clean up validate-commit-scope.ts

Refactored for noUncheckedIndexedAccess without scattering non-null
assertions: indexOf+slice for first-line, named regex groups for
capture extraction, .entries() for indexed loops. A single die(...)
helper replaces five near-identical console.error+exit blocks.
header.type narrows to an AllowedType union; the stringly-typed
cast in the recognized-type check is gone.

✅ refactor(dx): clean up validate-commit-scope.ts

Validator output and behavior unchanged; internal cleanup so future
edits start from a typed, narrowed baseline rather than scattered
assertions. No caller-visible change.
```

The second version is shorter, says what the reader needs to know (nothing observable changed,
internal hygiene), and stops there.

### Performance is user-facing

Numbers describing visitor experience or developer experience belong in the message. "Pre-push build
skipped on docs-only pushes (~1 s saved per push)" is fine. "Removed an extra `readFileSync` call"
without a wall-clock figure is mechanics — skip it.

### Test work

Mention what scenarios are now covered. Don't mention test counts, coverage percentages, or which
lint warnings were silenced.

---

## Patterns that work

### Feature — explain the why

```text
feat: add Beehiiv newsletter subscribe Pages Function

Visitors can join the newsletter list without leaving the site. A
serverless function at /api/subscribe forwards email + name to the
Beehiiv publication, maps API errors back to inline form status,
and avoids exposing the publication ID or API key to the browser.

Replaces the prior embedded iframe, which we couldn't style and
which forced a third-party CSP allowance.
```

### Bug fix — root cause, not just symptom

```text
fix: restore header data-stuck observer under script-src 'self'

The strict CSP introduced in the previous commit dropped script-src
'unsafe-inline', which silently killed the inline script that set
data-stuck on the header. Without it, the sticky header never
switched to its scrolled appearance.

Moved the observer into a module script so the existing script-src
'self' covers it.
```

### Trivial change — short title only

```text
chore: clear astro-check warnings
```

No body is required for genuinely small, obvious changes (typos, import sorting, one‑line config
tweaks). Use judgement: when the change could be read multiple ways, add a sentence.

---

## Forbidden patterns

🚨 **No project phase numbers.** "Phase 1", "Sprint 4", "Milestone B" mean nothing to a future
reader. Explain what the change _is_ instead.

```text
❌ feat: implement newsletter (Phase 2)
✅ feat: add Beehiiv newsletter subscribe Pages Function
```

🚨 **No internal task IDs without context.** Linear ticket numbers belong in the footer as
`Related to LIN-123`, not in the title.

🚨 **No "WIP", "fixup", or stack‑of‑fixes commits in main history.** Squash before merge.

---

## Proper nouns and initialisms

Always capitalize technology names and initialisms — in titles AND bodies.

| ❌      | ✅      |
| ------- | ------- |
| api     | API     |
| csp     | CSP     |
| mdx     | MDX     |
| oauth   | OAuth   |
| astro   | Astro   |
| next.js | Next.js |
| html    | HTML    |
| seo     | SEO     |
| og      | OG      |

Scope names in commit titles stay lowercase (`feat(content):`). This rule applies to description and
body text.

---

## Related

- [`commit-scopes.md`](./commit-scopes.md) — the four allowed scopes and rationale
- [`../../allowed-scopes.txt`](../../../.lvbt/commit-scopes.txt) — the file the hook reads
- [`../../.githooks/`](../../../.githooks) — the hooks themselves
- `validate-commit-message.mjs` in `@lvbt/cli` — the validator
