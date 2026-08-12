# Commit messages

The pinned `lvbt-contributions` plugin owns commit-subject validation for every
active Las Vegans for Better Transit repository. The local `commit-msg` hook
and the pull-request helper both use that one validator, so a title cannot be
valid locally but rejected when a contribution is opened.

## Subject

Write a Conventional Commit subject no longer than 72 characters:

```text
type(optional-scope): description
```

The allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`,
`refactor`, `revert`, `style`, and `test`. Reserve `feat` for a capability a
person can use or observe. Use a more precise type for internal groundwork.

## Scopes

Scopes are optional. When a change belongs to one durable repository boundary,
use only `web`, `worker`, `core`, `pwa`, `dx`, `tooling`, or `ci`.
Leave the scope out when the change crosses boundaries. A page, component,
file, task, contributor role, or temporary project name is not a scope.

## Bodies and pull requests

Use a commit body when future maintainers need the reason, constraint, or
trade-off. Wrap commit-message body lines at 72 characters. Pull-request
Markdown is different: write normal paragraphs in complete prose rather than
hard-wrapping every line.

The pull-request template begins with the outcome a person can use or observe,
then explains the important behavior or trade-off. Follow-ups are optional and
name unfinished product or reliability objectives, never chores such as
rebasing, formatting, or running checks.

## Related

- [Commit scopes](./commit-scopes.md)
- [Git guidelines](./git-guidelines.md)
- [The shared contribution plugin](https://github.com/LasVegasForTransit/repository-tooling)
