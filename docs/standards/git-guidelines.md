# Git Workflow Guidelines

> Workflow rules for committing in this repo. **For commit message composition (title, body, what to say and what not to say) see [`commit-messages.md`](./commit-messages.md).** For the scope list see [`commit-scopes.md`](./commit-scopes.md).

If anything here conflicts with `commit-messages.md`, the commit message guide wins.

---

## Staging discipline

"Staging" is choosing which changes go into the next commit (you stage a file with `git add`, then `git commit` records exactly what's staged). Getting this right matters because the commit message describes what you staged — stage the wrong files and the message lies about what changed.

- **Never** use `git add -A`, `git add .`, or `git add *`. Stage explicit paths. (Those forms grab _everything_ changed in the repo, including files you didn't mean to touch.)
- Run `git status` (or `git diff --staged`, which shows the exact staged changes) before every commit. Confirm exactly what's going in.
- For partial-file changes, use `git add -p` — the `-p` ("patch") flag walks you through each chunk of a file and asks whether to stage it, so you can commit part of a file and leave the rest.

The hooks run on whatever you staged. Staging too much is the easiest way to produce a commit that doesn't match its message.

---

## The atomic pattern

"Atomic" here means the whole sequence — unstage, stage, commit — runs as **one** command joined by `&&`, so it either fully succeeds or fully fails, with no half-done state left behind. The harness requires `git commit` to be preceded by `git restore --staged .` (which un-stages everything first, clearing any leftover staged files) in the same command chain. The canonical shape:

```bash
git restore --staged . \
  && git add path/to/file-a.ts path/to/file-b.ts \
  && git commit -F /tmp/msg.txt
```

Why:

- `git restore --staged .` clears any lingering staging from earlier commands.
- Explicit paths mean no surprises.
- The whole sequence succeeds or fails together via `&&`.
- The pre-commit and commit-msg hooks run once over the exact set you specified.

For multi-paragraph messages, write the message to a file first (e.g. `/tmp/msg.txt`) and use `git commit -F <path>`. Inline `-m "..."` works for single-line messages but mangles newlines and quote escaping for anything more.

---

## Trust the tooling

- The pre-commit and commit-msg hooks are authoritative. If a hook fails, the right move is to **fix what it reports**, not bypass.
- Don't run `pnpm typecheck` / `pnpm build` proactively over the whole repo. The hooks already gate the relevant subset for staged files; running everything pre-commit is wasted time. Run the full set when you've changed something that affects it (CI workflow, tsconfig, root `package.json`, etc.).
- Local `pnpm build` is fine for the section you've been working in.

---

## Don't bypass hooks

`git commit --no-verify` is a flag that tells Git to **skip the hooks** (the automated checks) entirely. It bypasses both the pre-commit and commit-msg hooks. It is **not the right answer** to a hook failure — the hooks are catching a real problem; silencing them just hides it. Fix the underlying issue and re-run the atomic command.

The two legitimate uses of `--no-verify` in this repo:

1. **History rewrites** — editing commits that already exist, rather than making a new one (e.g. fixing the wording of old commit messages). Here the hook context wouldn't apply (e.g. running `git rebase -i --root` to reword pre-existing messages — the commit-msg hook runs on each reword, but the pre-commit hook re-running its full pipeline against unrelated historical states is noise). For that case use `git -c core.hookspath=/tmp/empty-dir rebase -i --root` instead, so commit-msg still validates but pre-commit doesn't fire against unrelated history.
2. Genuine emergencies you can articulate. There aren't any of these in this repo.

---

## If hooks fail

1. Read the error output. Hooks emit actionable messages with "Fix:" sections.
2. Fix the underlying issue in the file the hook flagged.
3. Re-stage the fix (`git add <file>`).
4. Re-run the **same atomic command**. Don't try to amend or partially recover — start over from `git restore --staged .`.

**Do not** drop the failing file with `git restore`/`git reset` and re-commit without it. That's a bypass dressed as cleanup.

---

## Hook overview

**Git hooks** are scripts Git runs automatically at certain moments — here, right before a commit is recorded (`pre-commit`), as the message is checked (`commit-msg`), and before you push (`pre-push`). They're the project's automatic gatekeepers: they catch formatting, type, and message mistakes for you instead of relying on you to remember every rule.

### `commit-msg`

Validates the message against [`commit-messages.md`](./commit-messages.md):

- Conventional Commits format (`type(scope)?[!]?: description`).
- Allowed type: `feat fix docs refactor test chore perf`. `style` and `diag` are retired.
- Allowed scope: one of `content`, `ci`, `docs`, `dx`, or empty.
- `feat` and `fix` always require a body; other types require a body when staged change density `(files × 2) + (lines × 0.1)` exceeds 10.
- Body lines ≤ 72 characters. Trailers (`Co-Authored-By:`, etc.) exempt.

Fuzzy-matches near-miss scopes and suggests valid ones. See [`commit-scopes.md`](./commit-scopes.md) for the full scope list and rationale.

### `pre-commit`

Conditional gates on staged files:

- **`lint-staged`** (Prettier on `.js|.ts|.tsx|.astro|.md|.mdx|.css|.json|.ya?ml`) — auto-formats and re-stages.
- **`shellcheck`** on staged `.sh` files. Skipped if `shellcheck` not installed.
- **`pnpm check:docs --files <staged-docs>`** when `.md` or `.mdx` staged.
- **`pnpm exec astro check`** when `src/**` Astro / TS / TSX, `astro.config.*`, or root `tsconfig.json` staged.
- **`pnpm exec tsc -p scripts/tsconfig.json`** when anything under `scripts/` staged.
- **`actionlint`** on staged `.github/workflows/` or `.github/actions/`. Skipped if `actionlint` not installed.

If a category isn't represented in the staged set, the gate doesn't fire. Scripts-only commits don't run `astro check`; src-only commits don't run the scripts typecheck.

### `pre-push`

Heavier gates that run once per push:

1. Working tree clean (uncommitted changes invalidate build/typecheck results).
2. Every commit between `BASE..HEAD` matches the conventional-commit regex.
3. `pnpm typecheck` (full project).
4. `pnpm build` (full project) — **skipped** when the push only touches paths that can't affect output (`docs/`, `.githooks/`, `allowed-scopes.txt`, root-level `*.md`).

---

## What never belongs in a commit

- `git add -A` / `git add .` / `git add *` — stages everything indiscriminately. Don't.
- `git reset --hard` — permanently destroys uncommitted work. **Never.** If you need to discard, use `git restore --source=HEAD -- path` for specific files, or `git stash --include-untracked` for everything.
- `git commit -a` — commits without staging review.
- `git commit --no-verify` — bypasses the hooks. See above.
- Force-pushing this repo at all. Push the branch normally and let the required
  pull request preserve linear history.
- Project phase numbers in titles (`(Phase 2)`, `(Sprint 4)`). Explain what the change _is_.
- Internal task IDs in titles. Put them in the footer as `Related to LIN-123`.

---

## Discard / undo, the safe way

| Goal                                             | Command                                     | What it does                                                                                    |
| ------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Drop one file's working-tree changes             | `git restore --source=HEAD -- path/to/file` | Resets that one file back to its last-committed state; other files untouched.                   |
| Drop everything uncommitted (with backup)        | `git stash --include-untracked`             | Tucks all uncommitted changes (including new files) into a saved stash you can restore later.   |
| Undo the last commit but keep the changes staged | `git reset --soft HEAD~1`                   | Removes the commit but leaves its changes staged, ready to re-commit (e.g. with a new message). |
| Undo the last commit and unstage                 | `git reset HEAD~1`                          | Removes the commit and un-stages its changes, but keeps the edits in your files.                |
| Rewrite the last commit message                  | `git commit --amend`                        | Replaces the most recent commit with a new one (use to fix the message or add a staged file).   |
| Discard a stash                                  | `git stash drop stash@{0}`                  | Permanently deletes a saved stash you no longer need.                                           |

If you have to do anything more invasive than these, branch first: `git branch backup/$(date +%s)`.

---

## Related

- [`commit-messages.md`](./commit-messages.md) — what a commit message should say and not say
- [`commit-scopes.md`](./commit-scopes.md) — the four allowed scopes and rationale
- [`../../allowed-scopes.txt`](../../allowed-scopes.txt) — the file the hook reads
- [`../../.githooks/`](../../.githooks/) — the hooks themselves
- [`../../AGENTS.md`](../../AGENTS.md) — AI-agent guidance for working in this repo
