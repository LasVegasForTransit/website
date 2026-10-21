# Commit scope reference

Use this page when choosing the required name in a commit title, such as `functions` in
`fix(functions): Reject an expired sign-in link`. A scope names a lasting part of this repository.
Choose the owning domain when the change spans technical layers.

## Allowed scopes

The complete list lives in [`.lvbt/commit-scopes.txt`](../../.lvbt/commit-scopes.txt). The commit
message check reads that file.

| Scope       | What it covers                                                  | Example                                           |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `site`      | Pages, components, layouts, and styles in `apps/site`           | `fix(site): Keep the header readable on phones`   |
| `content`   | Public copy and content in `apps/site/src/content`              | `fix(content): Clarify how to join LVBT`          |
| `functions` | Server routes and the platform code behind them                 | `fix(functions): Reject an expired sign-in link`  |
| `bot`       | LVBT Discord automation, supporting services and administration | `feat(bot): Add private task check-ins`           |
| `docs`      | Repository documentation, rather than public site copy          | `docs(docs): Explain first-time setup`            |
| `dx`        | Local development tools, hooks, lint, and formatting            | `chore(dx): Check commit messages before pushing` |

Workflow and reusable-action changes under `.github/` use `chore(dx)`. Use `chore` for workflow
changes rather than the deprecated `ci` type or scope.

## What does not become a scope

A page, component, task, short-lived feature, dependency, or vendor does not get its own scope. For
example, use `fix(site): Repair the event header`, not `fix(EventHeader): …`. Explain the specific
change in the subject instead.

Changing the allowed list requires a separate decision. Do not add a scope just to make one commit
title fit.

<a id="crosscutting-changes"></a>

## Cross-cutting changes

Use the domain that owns the behavior across applications and integrations. For a change confined to
one architectural boundary, use that scope. Split unrelated changes into separate commits. Never
combine scopes as `feat(site,dx): …`.

Every commit needs a valid scope:

```text
feat(bot): Add private task check-ins
chore(dx): Update the repository standard
```

## Examples

These are message subjects, not commands to run:

```text
fix(functions): Preserve a member's saved consent
chore(dx): Check filenames before committing
docs(docs): Explain how to run a local preview
chore(dx): Update shared dependencies
```

## Related

Read [commit messages](./commit-messages.md) for subjects and bodies, and
[Git guidelines](./git-guidelines.md) for staging, hooks, and submitting a change.
