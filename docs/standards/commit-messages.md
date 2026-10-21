# Commit Message Standards

Contributors use this guide to explain a change to a maintainer who has no chat or task history.
Write what changes for a visitor, contributor, or operator. Explain the reason when the title alone
does not tell the reader enough.

The pinned `lvbt-contributions` plugin owns the shared validation rules. This guide explains how to
write within those rules.

---

## Quick format reference

```text
type(scope): brief description

Optional body explaining why, wrapped at 72 chars.

Optional footer (issue refs, co-authors, BREAKING CHANGE).
```

**Constraints:**

- Title at most 72 characters (displays in `git log --oneline`, email clients, GitHub UI).
- Start the description with a capital letter and a verb, such as "Add newsletter form".
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
- **Other types (`chore`, `refactor`, `docs`, `test`, `perf`):** Add a body whenever the change is
  big enough that the title alone could be read more than one way. A one-line tweak needs none.
- Body lines ≤72 chars. Trailers (`Co-Authored-By:`, `Signed-off-by:`, `Reviewed-by:`, `Acked-by:`)
  are exempt from the length cap.
- A commit an agent makes ends with a `Co-Authored-By:` trailer naming it. The `prepare-commit-msg`
  hook adds one when it is missing.

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
| `chore`    | Maintenance (dependencies, build/CI config, formatting, hooks, deps) | Operational rationale when the change is not obvious      |
| `perf`     | Performance improvements                                             | Before/after metrics when possible, bottleneck identified |

> The shared hook also accepts `build`, `revert`, and `style`. Prettier and the pre‑commit hook
> format everything automatically, so a `style` commit is rare. `ci` still passes but is deprecated
> and will be rejected from standard v0.6.0; use `chore` for workflow changes.

---

## Scopes

Only five scopes are valid: `site`, `content`, `functions`, `docs`, `dx`. See
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

The diff already shows which helpers moved and which variables changed. Explain why the new
structure matters to someone maintaining the result.

| Instead of describing an editing step | Explain the result                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| “Extracted configuration helpers.”    | “New setup phases use one definition, which prevents command output and validation from disagreeing.” |
| “Changed process spawning.”           | “Read-only audits run concurrently, which shortens local checks.”                                     |
| “Renamed internal variables.”         | Use a short title if the rename needs no further explanation.                                         |

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

Explain the maintenance problem that the restructuring solves. A title is enough for a small,
obvious cleanup. Add a body when the choice or trade-off matters.

### Performance is user-facing

Name the conditions under which you measured an improvement. A faster local fixture does not prove
that production uses fewer database reads.

Numbers describing visitor experience or developer experience belong in the message. "Pre-push build
skipped on docs-only pushes (~1 s saved per push)" is fine. "Removed an extra `readFileSync` call"
without a wall-clock figure is mechanics — skip it.

### Test work

Mention what scenarios are now covered. Don't mention test counts, coverage percentages, or which
lint warnings were silenced.

---

## Patterns that work

These examples illustrate the format. They are not claims about a deployed release.

### Feature — explain the why

```text
feat(content): Add an event signup link

Visitors can register from the event page. The link uses the same
registration destination as the calendar entry so staff maintain
one destination.
```

### Bug fix — root cause, not just symptom

```text
fix(site): Keep event dates in local time

An event near midnight appeared on the next day when the page used
UTC. The page now formats the date in the event's timezone.
```

### Trivial change — short title only

```text
docs: Correct a setup link
```

A title is enough for a small, obvious change. Add a body when the reason or trade-off matters.

---

## Forbidden patterns

Do not put “Phase 1,” “Sprint 4,” “WIP,” or “fixup” in the final history. Describe the change
itself. Put task references in the footer with enough context to understand their purpose. Follow
the [Git guidelines](./git-guidelines.md) before rewriting a branch's history.

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

- [`commit-scopes.md`](./commit-scopes.md) — the allowed scopes and rationale
- [`../../.lvbt/commit-scopes.txt`](../../.lvbt/commit-scopes.txt) — the file the hook reads
- [`../../.githooks/`](../../.githooks/) — the hooks, which run the organization's shared hooks from
  `@lasvegasfortransit/cli`
