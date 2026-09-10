# Update the repository standard

The LVBT web standard is committed under `.lvbt/web-platform/`. `.lvbt/web-platform.json` records its release tag, source commit, content hash, and executable files, so validation works without network access.

## Review an update

Choose a tagged release from `LasVegasForTransit/repository-tooling` and preview its exact file changes:

```sh
pnpm standards:update --release <tag>
```

The command performs a dry run unless `--apply` is present. It rejects moving branch names, local edits inside the vendor tree, invalid paths, and tags that do not resolve to one commit.

Read the release note and inspect each addition, change, and removal. Framework upgrades remain separate from hosting changes.

## Apply the release

```sh
pnpm standards:update --release <tag> --apply
pnpm install --frozen-lockfile
pnpm check
```

Update the contribution-plugin ref in `.claude/settings.json` to the same tag. Commit the vendor tree, metadata record, lockfile, and repository integration together. `pnpm standards:check` rejects partial updates and unrecorded vendor changes.
