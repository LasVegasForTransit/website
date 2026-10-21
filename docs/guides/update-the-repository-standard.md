# Update the repository standard

Use this guide to update the shared LVBT development tools and checks. The repository stores a copy
of that standard under `.lvbt/web-platform/`. `.lvbt/web-platform.json` records its release tag,
source commit, content hash, and executable files, so validation works without network access.

## Before you start

Complete [local setup](../tutorials/first-time-setup.md) and create a branch. Start with no local
edits under `.lvbt/web-platform/`; the updater refuses to overwrite them. Run commands from the
repository root.

## Review an update

Choose a tagged release from `LasVegasForTransit/repository-tooling` and preview its exact file
changes:

```sh
pnpm standards:update --release <tag>
```

The command performs a dry run unless `--apply` is present. It rejects moving branch names, local
edits inside the stored standard, invalid paths, and tags that do not resolve to one commit.

Read the release note and inspect each addition, change, and removal. Framework upgrades remain
separate from hosting changes.

## Apply the release

```sh
pnpm standards:update --release <tag> --apply
pnpm install --frozen-lockfile
pnpm check
```

Update the contribution-plugin ref in `.claude/settings.json` to the same tag. Commit the stored
standard, its version record, the lockfile, and the repository settings together. Share the update
through a pull request. `pnpm standards:check` rejects partial updates and unrecorded vendor
changes.
