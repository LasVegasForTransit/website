# Commit Scope Reference

> **The five scopes valid for commits in this repo, and why nothing else qualifies.**

The **scope** is the optional part in parentheses in a commit title — the `content` in
`fix(content): …`. It names which part of the project a commit touches. This page lists the only
five scopes you may use here, and why the list is so short.

Why only five? This is a single Astro (the framework that builds the site — see
[glossary](../reference/glossary.md#astro)) site with the Worker routes behind it, not a sprawling
platform with many independent subsystems. Only true architectural boundaries — parts that change on
their own, over and over — get a scope; everything else stays scopeless. The list is short on
purpose: if a scope wouldn't appear on at least five future commits, it isn't a real boundary and
shouldn't exist. A long scope list just becomes noise nobody can keep straight.

## Allowed scopes

| Scope                 | What it covers                                            | Typical commits                                       |
| --------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `site`                | The Astro site: pages, layouts, components, styles        | `fix(site): keep the header readable at 320 pixels`   |
| `content`             | MDX and copy under `apps/site/src/content/`               | `fix(content): rewrite about copy and § 02 layout`    |
| `apps/site/functions` | The Worker routes and the platform code behind them       | `fix(functions): reject an expired sign-in link`      |
| `docs`                | Repo documentation under `docs/` (NOT site copy)          | `docs(docs): add commit-messages standard`            |
| `dx`                  | Hooks, lint and format settings, dev scripts, local tools | `chore(dx): wire pre-commit and pre-push enforcement` |

Source of truth: [`../../.lvbt/commit-scopes.txt`](../../.lvbt/commit-scopes.txt). The commit‑msg
hook reads that file at validation time.

Workflow and composite-action changes under `.github/` are chores with no scope:
`chore: run the audit from apps/site`. The `ci` type and scope are deprecated across the
organization.

Empty scope is valid — and it's the common case. Just leave the parentheses off entirely:
`feat: add Beehiiv newsletter subscribe Pages Function`. Use an empty scope whenever none of the
five above fit, or when a change crosses them. Reach for one only when the change really is confined
to that boundary.

## What does **not** become a scope

| Anti‑pattern         | Why we reject it                                                  | What to write instead                              |
| -------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| Page slugs           | A page is not a separable subsystem; the title can name it        | `feat: public projects roadmap …`                  |
| Component names      | Same — too fine a grain, churns with every refactor               | `fix: restore header data-stuck observer …`        |
| Short‑lived features | A feature with 3–5 commits isn't a subsystem                      | `feat: add Beehiiv newsletter subscribe …`         |
| `deps`               | Dep bumps are inherently cross‑cutting                            | `chore: bump astro to 4.16`                        |
| Vendor tags          | `cf`, `gcp`, etc. lock the log to a particular provider           | `chore: add wrangler.jsonc for pages dev`          |
| Subsystem aliases    | `csp`, `seo`, `audit` describe slices of one site, not boundaries | `chore: remove Beehiiv iframe allowances from CSP` |

Adding a sixth scope is a deliberate act. Don't slip one in alongside a feature commit.

## Cross‑cutting changes

Sometimes one commit touches two of the five boundaries at once — say, a hook change (`dx`) that
also edits the join page (`site`). When that happens, the tie-break is: **pick the scope where most
of the change lives** (the dominant one), or, if it's a genuine even split, **omit the scope
entirely**. Don't stack two scopes in one title — there's no `feat(site,dx):` form.

## Examples

```bash
git commit -m "feat: add Beehiiv newsletter subscribe Pages Function"
git commit -m "chore: drop github expression from composite action description"
git commit -m "chore(dx): adopt lovelace commit-msg / pre-commit / pre-push enforcement"
git commit -m "refactor(content): rewrite about copy and § 02 layout"
git commit -m "docs(docs): add commit-messages standard"
git commit -m "chore: NBSP between \"Las Vegas\" in display contexts"
```

## Related

- [`commit-messages.md`](./commit-messages.md) — full message standards
- [`../../.lvbt/commit-scopes.txt`](../../.lvbt/commit-scopes.txt) — runtime scope list
- The validator is the organization's shared commit-msg hook in `@lasvegasfortransit/cli`
