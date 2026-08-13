# AGENTS.md

This is the Astro site for Las Vegans for Better Transit. It deploys to
Cloudflare Pages through pull requests with linear history and the `Validate`
check. Write for contributors who may be new to the stack: explain the reason
for a choice, not merely the command that implements it.

## Start here

- [`docs/tutorials/start-here.md`](./docs/tutorials/start-here.md) explains the
  project and its vocabulary.
- [`docs/standards/commit-messages.md`](./docs/standards/commit-messages.md)
  explains the shared LVBT title policy and readable PR prose.
- [`docs/standards/git-guidelines.md`](./docs/standards/git-guidelines.md)
  covers explicit staging, hooks, and the full check.

The pinned `lvbt-contributions` plugin is the single source of truth for
commit subjects and agent-created GitHub contributions. The `prepare` script
wires `.githooks/` during `pnpm install`; do not replace the shared validator
with a website-local scope list.

## Commit subjects and pull requests

Use `type(optional-scope): description`, no longer than 72 characters. Scopes
are optional; the complete website-specific list lives in
`.lvbt/commit-scopes.txt`. Omit the scope for cross-boundary work. Do not turn
a page, component, file, task, or role into a scope.

Reserve `feat` for a capability a person can use or observe. A refactor,
configuration change, or tooling foundation should use the more precise
conventional type. Commit bodies explain the important reason or trade-off and
wrap at 72 characters. Pull-request Markdown uses normal, complete paragraphs
rather than forced narrow lines or a file inventory.

## Workflow expectations

- Work on a branch and use a pull request for every change to `main`.
- Stage explicit paths; never use `git add .`, `git add -A`, or a wildcard.
- Do not bypass a failing hook. Repair the reported problem and rerun it.
- Do not use `git reset --hard`. Restore one path or create a stash when that
  is genuinely the desired recovery.
- Run `pnpm check` before a pull request or push when the whole repository
  needs validation. It is the same validation-and-build path CI uses.

Only commit when the user explicitly authorizes a commit in the current task.

## Create GitHub issues and pull requests

Use the mandatory `github-contribution` skill from the pinned
`lvbt-contributions` plugin whenever a user authorizes creating an issue or
pull request. It carries the organization checklist, readable templates, and
the only approved creation helper:

```bash
node plugins/lvbt-contributions/scripts/github-create.mjs issue \
  --type bug|feature --title <title> --body-file <file>
node plugins/lvbt-contributions/scripts/github-create.mjs pr \
  --title <title> --body-file <file> --base main
```

Preview with `--dry-run --json`, remove every bracketed prompt, and inspect the
complete visible Markdown before creating anything. Do not call `gh issue
create`, `gh pr create`, equivalent `gh api` routes, or connector creation
tools directly. Humans use the native organization issue forms and pull
request template; agents use the same visible structure.

## Stack quick map

- Astro 4 and Tailwind v4; editable MDX and JSON live under `src/content/`.
- Cloudflare Pages hosts the site; `pnpm dev` runs Astro and local Pages
  Functions together.
- pnpm 11.15.1 and Node 24.18.0 are the local toolchain.
- Playwright provides visual-regression tests and screenshots.
- `scripts/bootstrap/` owns `pnpm bootstrap` and `pnpm preflight`.
- `scripts/audit/` owns CI and release audit checks.
- `src/lib/site.ts` owns organization metadata and public URLs.
- Events come from Google Calendar; see
  [`docs/explanation/events-pipeline.md`](./docs/explanation/events-pipeline.md).
- Newsletter issues come from Beehiiv; see
  [`src/lib/newsletter-loader.ts`](./src/lib/newsletter-loader.ts).
- Membership intake and transit-news automation are documented in
  [`docs/reference/membership-intake.md`](./docs/reference/membership-intake.md)
  and [`docs/guides/add-transit-news.md`](./docs/guides/add-transit-news.md).

## Related

- [`README.md`](./README.md)
- [`docs/README.md`](./docs/README.md)
- [`docs/reference/glossary.md`](./docs/reference/glossary.md)
- [`docs/standards/writing-docs.md`](./docs/standards/writing-docs.md)
