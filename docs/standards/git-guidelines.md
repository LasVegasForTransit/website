# Git workflow guidelines

Use this guide to choose changes for a commit, run the required checks, and submit a pull request.
Read [commit messages](./commit-messages.md) for the title and body, and
[commit scopes](./commit-scopes.md) for the optional area name in a title. The commit message guide
wins if a message rule differs between these pages.

## Staging discipline

Staging means choosing what the next commit will record. Before staging or committing, inspect both
your edits and anything already staged:

```sh
git status
git diff
git diff --staged
```

Stage explicit paths, such as `git add docs/guides/add-an-event.md`. Do not use `git add .`,
`git add -A`, `git add *`, or `git commit -a`. Those commands can include unrelated work. Use
`git add -p path/to/file` when you need to choose individual changes within a file.

Do not remove another person's staged changes to make your own commit easier. Stop and establish
which changes belong together before altering an index you do not own.

## The atomic pattern

When you control the staged set and need to rebuild it, use this sequence. Replace the example paths
with the exact files for your change, and write the message file first:

```sh
git restore --staged . \
  && git add path/to/file-a.ts path/to/file-b.ts \
  && git commit -F /tmp/msg.txt
```

`git restore --staged .` removes files from the staging area; it does not discard their edits. Each
`&&` runs the next command only if the previous command succeeds. This is **not a database
transaction**: Git does not undo earlier commands if a later one fails. Check `git status` after a
failure before continuing.

Use a message file with `git commit -F <path>` rather than embedding a multi-paragraph message in a
shell argument. This preserves newlines and avoids accidental shell expansion.

## Trust the tooling

Run `pnpm check` before pushing. GitHub runs the same checks. `pnpm check:fix` can repair formatting
and some lint errors; it cannot repair every failed check.

The scripts in [`.githooks/`](../../.githooks/) call the shared LVBT tools from
`@lasvegasfortransit/cli`. `pnpm install` sets up these hooks through the `prepare` script. Change a
shared rule in `LasVegasForTransit/repository-tooling`, rather than editing the vendored copy here.

## Don't bypass hooks

A Git hook is a script Git runs at a particular step, such as before recording a commit or before
pushing. `--no-verify` skips checks. Do not use it to get past a failure, and do not change
`core.hooksPath` to hide a failing check.

A history rewrite changes existing commits and requires separate care and authorization. Do not use
a history-rewrite recipe as a routine way to bypass checks on a new change.

## If hooks fail

Read the error and its suggested fix. Repair the reported problem, stage that exact path again, and
rerun the commit sequence after confirming that you still control the staged set. Check the message
if the `commit-msg` hook fails.

Do not discard a necessary change just to make the check pass. If a file belongs to a different
change, explain that separation and validate both changes appropriately.

## Hook overview

### `prepare-commit-msg`

Adds a missing `Co-Authored-By:` line when a coding agent creates the commit.

### `commit-msg`

Checks the [message rules](./commit-messages.md): an allowed type and optional scope, a subject no
longer than 72 characters, a body for `feat` and `fix`, body lines no longer than 72 characters, and
agent attribution when required. Attribution and other footer lines are exempt from the body
line-length limit.

### `pre-commit`

Formats staged files with Prettier, checks staged source and test filenames, and checks the staged
change for secrets according to the shared hook's configuration. CI also runs its required secret
scan. Fix a configured scan failure rather than skipping it.

### `pre-push`

Runs `pnpm check` and uploads the Git Large File Storage (LFS) objects used for screenshot
references. The custom hook handles that upload because it replaces Git LFS's default hook.

## What never belongs in a commit

Keep credentials, unrelated edits, internal task IDs, and project phase numbers out of commit
subjects. Put a useful issue reference in the footer instead. Do not force-push this repository;
submit a branch through a pull request and preserve linear history.

Never use `git reset --hard`. It destroys uncommitted edits.

## Discard / undo, the safe way

Inspect `git status` and `git diff` first. These commands have different effects:

| You need to…                                      | Command                                     | Effect                                                                               |
| ------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Discard edits to one file                         | `git restore --source=HEAD -- path/to/file` | Replaces that file with its last committed contents; its uncommitted edits are lost. |
| Save unfinished work                              | `git stash --include-untracked`             | Saves tracked edits and untracked files so you can restore them later.               |
| Undo your last commit but keep its changes staged | `git reset --soft HEAD~1`                   | Moves your branch back one commit and keeps its edits in the staging area.           |
| Undo your last commit and unstage its changes     | `git reset HEAD~1`                          | Moves your branch back one commit and keeps its edits in the working files.          |
| Correct your last commit message                  | `git commit --amend`                        | Replaces your last commit; check whether anyone else already uses it.                |
| Delete a saved stash                              | `git stash drop stash@{0}`                  | Permanently removes that saved copy.                                                 |

Resetting or amending published commits changes shared history. Do not do it as routine cleanup.
Create a backup branch before more involved recovery, and keep any required authorization separate
from ordinary editing.

## Related

Use the [message guide](./commit-messages.md) for wording, the
[scope list](../../.lvbt/commit-scopes.txt) for accepted names, and [AGENTS.md](../../AGENTS.md) for
the repository's agent instructions.
