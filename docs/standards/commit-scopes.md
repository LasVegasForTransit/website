# Commit scope reference

Use this page when choosing the feature or domain in a commit title, such as `membership` in
`fix(membership): Preserve a member's saved consent`. Every commit has a scope. Choose the domain
whose behavior changes, even when its implementation spans server routes, storage, and pages.

## Allowed scopes

The complete list lives in [`.lvbt/commit-scopes.txt`](../../.lvbt/commit-scopes.txt). The commit
message check reads that file.

| Scope        | What it covers                                                 | Example                                              |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------------- |
| `site`       | Public website navigation, layout, and visual design           | `fix(site): Keep the header readable on phones`      |
| `content`    | Published editorial content                                    | `fix(content): Clarify how to join LVBT`             |
| `membership` | Member signup, membership records, and membership-based access | `fix(membership): Preserve a member's saved consent` |
| `docs`       | Repository documentation, rather than public site copy         | `docs(docs): Explain first-time setup`               |
| `dx`         | Local development tools, hooks, lint, and formatting           | `chore(dx): Check commit messages before pushing`    |

Workflow and reusable-action changes under `.github/` use `chore(dx)`. Use `chore` for workflow
changes rather than the deprecated `ci` type or scope.

## What does not become a scope

A scope describes the feature or domain a maintainer wants to follow in the history. A component,
file, task, dependency, vendor, or implementation layer does not describe that domain. For example,
membership behavior belongs under `membership` regardless of whether its code runs in a Worker or
renders a page. Explain the specific change in the subject.

When a feature or domain is missing, add it to the list with a clear definition. Keep names useful
across changes to that domain instead of naming a single implementation task.

<a id="crosscutting-changes"></a>

## Cross-cutting changes

Use the domain that explains the resulting behavior, rather than counting which folders changed.
Split independent changes when they have different purposes. Use `docs` for repository documentation
and `dx` for contributor tooling. Never combine scopes as `feat(site,dx): …`.

For example:

```text
feat(membership): Add newsletter signup
chore(dx): Update the repository standard
```

## Examples

These are message subjects, not commands to run:

```text
fix(membership): Preserve a member's saved consent
chore(dx): Check filenames before committing
docs(docs): Explain how to run a local preview
chore(dx): Update shared dependencies
```

## Related

Read [commit messages](./commit-messages.md) for subjects and bodies, and
[Git guidelines](./git-guidelines.md) for staging, hooks, and submitting a change.
