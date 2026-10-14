# Back up and verify the membership database

Use this procedure before a membership database migration or recovery operation. It creates a
private SQL backup and checks that it restores into an isolated local database before you depend on
it.

## Before you start

You need the maintainer's authorization to read the selected database, an approved Cloudflare
credential with the required database access, and the repository's Node.js and pnpm setup. Run
commands from the repository root. Use the database and configuration from the release you are
preparing, not an unrelated checkout with newer migrations.

Choose an approved private directory outside every repository and outside shared or automatically
published folders. Restrict access to the operator. A complete database backup includes member
records and authentication data; treat the restored copy with the same care as the original. Record
its owner, retention period, and permitted location in the private operational record.

The examples select **preview**, `lvbt-platform-preview`. Production is `lvbt-platform` and needs
its own authorization. In the production export and read-only comparison commands, use
`lvbt-platform` and omit `--env preview`. Do not change a restore command to use `--remote`.

## 1. Confirm the source and save its inventory

In Cloudflare, select the LVBT account and open **Storage & databases → D1**. Confirm the intended
database's name and ID against `apps/staff/wrangler.jsonc`. If the account, database, or permission
cannot be verified, stop before exporting.

List the source's application schema and migration names in your private terminal:

```sh
pnpm -C apps/staff exec wrangler d1 execute lvbt-platform-preview --remote --env preview --command "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') AND sql IS NOT NULL ORDER BY type, name"
pnpm -C apps/staff exec wrangler d1 execute lvbt-platform-preview --remote --env preview --command "SELECT name FROM d1_migrations ORDER BY id"
```

Save the inventory privately with the environment and backup time. An unused database may not yet
have `d1_migrations`; record that fact rather than applying migrations to prepare a backup.

## 2. Export schema and data together

Arrange an interruption window with the maintainer before starting. D1 cannot serve queries during
the remote export, so the member website, staff portal, and jobs sharing that database may fail
requests until it finishes. This applies to preview too; production needs a coordinated window for
its real users. Read and accept Wrangler's export prompt only when that window is approved.

Replace `/private/approved-backups/staff-preview.sql` below with a new file in your approved
directory. Keep schema and data enabled; an export containing only one is not a complete backup.

```sh
pnpm -C apps/staff exec wrangler d1 export lvbt-platform-preview --remote --env preview --output /private/approved-backups/staff-preview.sql
```

Wait for successful completion and confirm the file exists and is nonempty. Retain a checksum with
the private backup record so later changes can be detected:

```sh
shasum -a 256 /private/approved-backups/staff-preview.sql
```

Cloudflare documents the export and import options in its
[D1 command reference](https://developers.cloudflare.com/d1/wrangler-commands/) and
[import and export guide](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## 3. Restore into a fresh local directory

Choose a second, unused private directory for local database storage. The example is
`/private/approved-backups/restore-check`; replace it with your chosen path. Do not start the
website, staff app, or jobs runner against this restored database. Restored sessions and pending
provider work are data to inspect, not permission to run them.

```sh
pnpm -C apps/staff exec wrangler d1 execute lvbt-platform-preview --local --env preview --persist-to /private/approved-backups/restore-check --file /private/approved-backups/staff-preview.sql
```

The database name selects the local binding; `--local` and the unused `--persist-to` directory keep
the import separate from the hosted database and your normal development data. A successful import
is the first check, not the entire verification.

## 4. Compare the restored data

Read the restored schema and migration inventory using that same local directory:

```sh
pnpm -C apps/staff exec wrangler d1 execute lvbt-platform-preview --local --env preview --persist-to /private/approved-backups/restore-check --command "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') AND sql IS NOT NULL ORDER BY type, name"
pnpm -C apps/staff exec wrangler d1 execute lvbt-platform-preview --local --env preview --persist-to /private/approved-backups/restore-check --command "SELECT name FROM d1_migrations ORDER BY id"
```

Compare every application table, its schema, migration names, and row totals with the source
inventory. Provider-internal tables may differ; application tables and their data must be present.
For each application table, use `SELECT COUNT(*) FROM <table_name>` with the source command from
step 1 and the local command from this step. Replace `<table_name>` with the reviewed table name,
not a value copied from an untrusted submission. Inspect a small approved sample of linked member,
consent, and committee records privately to confirm their relationships survived.

Source writes between export and comparison can change totals. Investigate a difference before
accepting the backup; do not alter the backup to make it match. Coordinate a stable comparison
window with the maintainer if necessary. An import error, missing application table, or unexplained
data difference leaves verification incomplete. Keep the source unchanged while investigating.

## 5. Retain the verified backup and clean up the test copy

Record the source database, export time, checksum, restore outcome, and any limits in the private
backup record. Keep the verified SQL file in the approved protected location for its retention
period. Remove the disposable restore directory after verification and confirm it is the local copy
you created; never delete the hosted database as part of this cleanup.

A verified backup supports a separately reviewed recovery plan. Do not import it over a live
database or reverse migrations to undo an application release. Restoring old data can erase newer
consent withdrawals, staff activity, and access-removal work. Use the
[release recovery procedure](../reference/staff-portal-operations.md#recover-a-failed-preview-activation)
for an application activation failure, and obtain a specific data-recovery plan before changing
hosted records.
