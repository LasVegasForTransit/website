# Commit Scope Reference

> **The four scopes valid for commits in this repo, and why nothing else qualifies.**

The **scope** is the optional part in parentheses in a commit title — the `content` in `fix(content): …`. It names which part of the project a commit touches. This page lists the only four scopes you may use here, and why the list is so short.

Why only four? This is a single Astro (the framework that builds the site — see [glossary](../reference/glossary.md#astro)) site, not a sprawling platform with many independent subsystems. Only true architectural boundaries — parts that change on their own, over and over — get a scope; everything else stays scopeless. The list is short on purpose: if a scope wouldn't appear on at least five future commits, it isn't a real boundary and shouldn't exist. A long scope list just becomes noise nobody can keep straight.

## Allowed scopes

| Scope     | What it covers                                     | Typical commits                                             |
| --------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `content` | MDX and copy under `src/content/`                  | `fix(content): rewrite about copy and § 02 layout`          |
| `ci`      | `.github/workflows/` and composite actions         | `fix(ci): drop redundant env re-export in deploy composite` |
| `docs`    | Repo documentation under `docs/` (NOT site copy)   | `docs(docs): add commit-messages standard`                  |
| `dx`      | Hooks, lint config, dev scripts, local‑dev tooling | `chore(dx): wire pre-commit and pre-push enforcement`       |

Source of truth: [`../../allowed-scopes.txt`](../../allowed-scopes.txt). The commit‑msg hook reads that file at validation time.

Empty scope is valid — and it's the common case. Just leave the parentheses off entirely: `feat: add Beehiiv newsletter subscribe Pages Function`. Use an empty scope whenever none of the four above fit, which is most of the time (anything touching the actual site pages, components, or features). Reach for one of the four only when the change really is confined to that boundary.

## What does **not** become a scope

| Anti‑pattern         | Why we reject it                                                  | What to write instead                              |
| -------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| Page slugs           | A page is not a separable subsystem; the title can name it        | `feat: public projects roadmap …`                  |
| Component names      | Same — too fine a grain, churns with every refactor               | `fix: restore header data-stuck observer …`        |
| Short‑lived features | A feature with 3–5 commits isn't a subsystem                      | `feat: add Beehiiv newsletter subscribe …`         |
| `deps`               | Dep bumps are inherently cross‑cutting                            | `chore: bump astro to 4.16`                        |
| Vendor tags          | `cf`, `gcp`, etc. lock the log to a particular provider           | `chore: add wrangler.jsonc for pages dev`          |
| Subsystem aliases    | `csp`, `seo`, `audit` describe slices of one site, not boundaries | `chore: remove Beehiiv iframe allowances from CSP` |

Adding a fifth scope is a deliberate act. Don't slip one in alongside a feature commit.

## Cross‑cutting changes

Sometimes one commit touches two of the four boundaries at once — say, a hook change (`dx`) that also edits a CI workflow (`ci`). When that happens, the tie-break is: **pick the scope where most of the change lives** (the dominant one), or, if it's a genuine even split, **omit the scope entirely**. Don't stack two scopes in one title — there's no `feat(ci,dx):` form.

## Examples

```bash
git commit -m "feat: add Beehiiv newsletter subscribe Pages Function"
git commit -m "fix(ci): drop github expression from composite action description"
git commit -m "chore(dx): adopt lovelace commit-msg / pre-commit / pre-push enforcement"
git commit -m "refactor(content): rewrite about copy and § 02 layout"
git commit -m "docs(docs): add commit-messages standard"
git commit -m "chore: NBSP between \"Las Vegas\" in display contexts"
```

## Related

- [`commit-messages.md`](./commit-messages.md) — full message standards
- [`../../allowed-scopes.txt`](../../allowed-scopes.txt) — runtime scope list
- [`../../scripts/validation/git/validate-commit-scope.ts`](../../scripts/validation/git/validate-commit-scope.ts) — validator source
