# Commit Message Standards

> **Authoritative reference for writing commit messages in the LVBT website repo.** Adapted from the lovelace platform standards, scaled down to a single Astro site.

Commit messages are the permanent record of why code exists. The diff shows the mechanics; the message explains everything else. Someone reading `git log` a year from now has nothing else to go on.

---

## Quick format reference

```
type(scope): brief description

Optional body explaining why, wrapped at 72 chars.

Optional footer (issue refs, co-authors, BREAKING CHANGE).
```

**Constraints:**

- Title under 72 characters (displays in `git log --oneline`, email clients, GitHub UI).
- Imperative mood: "Add newsletter form", not "Added newsletter form".
- Specific: "Fix header observer under strict CSP" beats "Fix bug".
- Proper nouns and initialisms capitalized — API, CSP, MDX, OAuth, Astro, Cloudflare, Pages, Beehiiv. Names are not lowercase words.

---

## Message anatomy

### Title (required)

`type(scope): description` — the only required part. Conventional Commits format, validated by the commit‑msg hook.

### Body (required for `feat` and `fix`; conditional otherwise)

Separated from title by a blank line, wrapped at 72 characters. This is where context lives — _why_ the change was necessary, what alternatives existed, what trade‑offs were made.

- **`feat` and `fix` commits:** Always include a body. The hook enforces this.
- **Other types (`chore`, `refactor`, `docs`, `test`, `perf`):** Body required when the change density `(files × 2) + (lines × 0.1)` exceeds 10. Single‑line fixes are exempt.
- Body lines ≤72 chars. Trailers (`Co-Authored-By:`, `Signed-off-by:`, `Reviewed-by:`, `Acked-by:`) are exempt from the length cap.

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

> `style` is **not** valid. Prettier and the pre‑commit hook enforce formatting automatically, so a dedicated style commit should never be needed. Use `chore` if formatting slips through.

---

## Scopes

Only four scopes are valid: `content`, `ci`, `docs`, `dx`. See [commit-scopes.md](./commit-scopes.md) for the full list and rationale. Empty scope is the default for everything else (`feat: add newsletter form`).

Do **not** invent ad‑hoc scopes for page slugs, components, short‑lived features, dep bumps, or vendor names. The commit‑msg hook rejects anything outside the curated list.

---

## Write for the public log

A future reader has no Slack context, no PR description, no issue tracker access. Write each message as if it ships in a public changelog.

**Avoid implementation noise** that doesn't change what someone can do:

❌ "wires up createSubscribeMiddleware factory and threads context through SubscribeService"

✅ "Visitors can subscribe to the newsletter without leaving the page; submissions hit /api/subscribe and surface inline status."

The diff already shows the factories and the threading. The message should tell a future maintainer what changed about the site's capability.

**Performance is user‑facing.** "Reduced Lighthouse LCP from 3.2s to 1.4s by deferring third‑party fonts" — keep it.

**Test counts and coverage percentages are not user‑facing.** Mention what scenarios are covered, not how many tests there are.

---

## Patterns that work

### Feature — explain the why

```
feat: add Beehiiv newsletter subscribe Pages Function

Visitors can join the newsletter list without leaving the site. A
serverless function at /api/subscribe forwards email + name to the
Beehiiv publication, maps API errors back to inline form status,
and avoids exposing the publication ID or API key to the browser.

Replaces the prior embedded iframe, which we couldn't style and
which forced a third-party CSP allowance.
```

### Bug fix — root cause, not just symptom

```
fix: restore header data-stuck observer under script-src 'self'

The strict CSP introduced in the previous commit dropped script-src
'unsafe-inline', which silently killed the inline script that set
data-stuck on the header. Without it, the sticky header never
switched to its scrolled appearance.

Moved the observer into a module script so the existing script-src
'self' covers it.
```

### Trivial change — short title only

```
chore: clear astro-check warnings
```

No body is required for genuinely small, obvious changes (typos, import sorting, one‑line config tweaks). Use judgement: when the change could be read multiple ways, add a sentence.

---

## Forbidden patterns

🚨 **No project phase numbers.** "Phase 1", "Sprint 4", "Milestone B" mean nothing to a future reader. Explain what the change _is_ instead.

```
❌ feat: implement newsletter (Phase 2)
✅ feat: add Beehiiv newsletter subscribe Pages Function
```

🚨 **No internal task IDs without context.** Linear ticket numbers belong in the footer as `Related to LIN-123`, not in the title.

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

Scope names in commit titles stay lowercase (`feat(content):`). This rule applies to description and body text.

---

## Related

- [`commit-scopes.md`](./commit-scopes.md) — the four allowed scopes and rationale
- [`../../allowed-scopes.txt`](../../allowed-scopes.txt) — the file the hook reads
- [`../../.githooks/`](../../.githooks/) — the hooks themselves
- [`../../scripts/validation/git/validate-commit-scope.ts`](../../scripts/validation/git/validate-commit-scope.ts) — the validator
