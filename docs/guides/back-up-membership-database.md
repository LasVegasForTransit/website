# Back up and verify the membership database

For daily production backups to private R2 and quarterly restore tests, use the
[automated backup guide](./member-database-backups.md).

Maintainers use this procedure before changing the membership database's structure (a migration) or
recovering its records. It creates a private SQL backup and checks that it restores into an isolated
local database before you depend on it.

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

Cloudflare D1 is the hosted database service. Wrangler is its command-line tool, which the commands
below run through pnpm. A SQL backup contains the database's table definitions and records. See the
[glossary](../reference/glossary.md) for these tools.

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
directory. Include both the table definitions (schema) and the records (data); a backup needs both.

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

### Alternative: export through the signed-in dashboard

Use Wrangler when its approved credential can access the selected account. If only the existing
Cloudflare browser session has access, a database maintainer can prepare a backup through **Explore
Data** without creating a credential or copying the browser's sign-in information. This is a manual
fallback for a small database, not an automatic repository command. It requires a reviewed, private
export and restoration program before you start. Keep that program with the backup so another
maintainer can repeat the verification.

1. Recheck the LVBT account, **lvbt-platform-preview**, and its database ID. In **Console**, run the
   schema inventory from step 1. Select **Explore Data** to open D1 Studio, then use its **Query**
   editor to run the same read-only query. Select **Export query results → CSV**. CSV means
   comma-separated values; this download is the complete result, not just the rows currently visible
   in the table. Move it out of Downloads into the protected backup directory immediately.
2. Have the private program read the exported table definitions and prepare one read-only `SELECT`
   that returns a single JSON snapshot. JSON is a structured text format. The snapshot must include
   the current schema, every application table and column, table row totals, the `d1_migrations`
   records, row identifiers, and `sqlite_sequence` values used by automatically numbered records.
   Include indexes and triggers in the schema. Record provider-owned tables separately; do not
   describe their omission as a complete copy of Cloudflare's internal storage.
3. Preserve each value's SQLite storage type as well as its contents. An ordinary CSV export of
   individual tables can confuse an empty string with a missing value, lose binary data, or round a
   large number. A typed JSON value can use this expression, replacing `"column_name"` with each
   reviewed column identifier:

   ```sql
   json_array(
     typeof("column_name"),
     CASE WHEN typeof("column_name") = 'real'
       THEN printf('%!.17g', "column_name")
       ELSE hex("column_name") END
   )
   ```

   The restoration program must decode hexadecimal text and binary values, preserve whole numbers
   without JavaScript number conversion, preserve missing values, and round-trip decimal values.
   Verify its handling of empty text, embedded zero bytes, binary data, and large whole numbers on
   disposable local data. Refuse an unsupported type or an incomplete result.

4. Paste the complete prepared query into the Studio editor using its normal editing controls.
   Select **Run** and confirm the result has the expected snapshot column and exactly one row. A
   query error, the previous query's column headings, truncated JSON, or a missing table means the
   backup is incomplete. Do not export an old result as a substitute. Export this result as CSV and
   move it into the protected directory. Restrict the directory to its owner and the files to that
   owner's read/write access, for example `chmod 700 <directory>` and `chmod 600 <file>`.
5. Reconstruct the SQL backup privately. Create tables before inserting data, then create their
   indexes and triggers after insertion so restoration does not run membership actions. Preserve
   stored row identifiers and numbering sequences. Never execute generated statements against the
   hosted database. Restore into a fresh, isolated local SQLite database and perform step 4 below,
   including SQLite's `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.
6. Compare the complete restored schema and every typed value with the snapshot, not only record
   totals. Compare each table in a stable order and retain its checksum privately. Run and export a
   second complete snapshot from Studio; it must match the backup's schema, tables, values and
   numbering sequences. A difference means the source changed: arrange a stable window and repeat
   the backup rather than editing either result to make them agree.

This fallback runs ordinary read queries instead of the provider's full export operation. It does
not copy Cloudflare-managed recovery state, make a live restore safe, or prove that a future
migration will succeed. A large database may exceed query, response, or browser download limits;
stop and use the approved Wrangler export path if you cannot verify an exact copy. Retain the source
downloads, reconstructed SQL, private program, checksums and verification together under step 5. Do
not start an application against the restored authentication or pending-job data.

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
[release recovery procedure](../reference/staff-release-operations.md#recover-a-failed-preview-activation)
for an application activation failure, and obtain a specific data-recovery plan before changing
hosted records.
