# Commit Scope Reference

> **The four scopes valid for commits in this repo, and why nothing else qualifies.**

This is a single Astro site, not a platform. Only true architectural boundaries get a scope; everything else stays scopeless. The list is short on purpose — if a scope wouldn't appear on at least five future commits, it shouldn't exist.

## Allowed scopes

| Scope     | What it covers                                     | Typical commits                                             |
| --------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `content` | MDX and copy under `src/content/`                  | `fix(content): rewrite about copy and § 02 layout`          |
| `ci`      | `.github/workflows/` and composite actions         | `fix(ci): drop redundant env re-export in deploy composite` |
| `docs`    | Repo documentation under `docs/` (NOT site copy)   | `docs(docs): add commit-messages standard`                  |
| `dx`      | Hooks, lint config, dev scripts, local‑dev tooling | `chore(dx): wire pre-commit and pre-push enforcement`       |

Source of truth: [`../../allowed-scopes.txt`](../../allowed-scopes.txt). The commit‑msg hook reads that file at validation time.

Empty scope is valid: `feat: add Beehiiv newsletter subscribe Pages Function`. Use it whenever none of the four fit.

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

If a commit spans two of the four scopes (e.g., a hook change that also edits a workflow), pick the dominant one or omit the scope entirely.

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
