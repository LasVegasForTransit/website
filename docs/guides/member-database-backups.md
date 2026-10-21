# Back up and recover the member database

Maintainers use the **Member database backups** GitHub Actions workflow to keep a recovery copy of
member data. The workflow saves a daily, encrypted copy of the production member database to the
private `lvbt-member-backups` R2 bucket. Objects under `production/` expire after 30 days. The
bucket uses Standard storage and has no public access. Backups contain the complete application
schema and stored values, including consent, identities, sessions and synchronization state. They
exclude Cloudflare internal tables, external mailing lists and other databases.

## Before you start

You need maintainer access to the website repository's GitHub Actions and permission to manage the
backup credentials below. Use the GitHub workflow for routine backups and checks. Use a private
workstation only for the local test or a separately approved recovery. Keep member data private.

## Schedule and checks

The workflow runs from `main` at these UTC times:

- Daily at 10:17: capture production, restore locally, encrypt and upload, then download and compare
  the encrypted file before publishing a success receipt.
- Daily at 12:43: fail if the latest committed backup is older than 26 hours, unavailable or
  damaged.
- January, April, July and October 1 at 14:17: download the latest backup, decrypt it and restore
  into a fresh local database. Check integrity, foreign keys and exact schema, storage types,
  values, row identifiers and sequences. No application process runs against this database.

GitHub schedules can be delayed. A healthy daily schedule limits expected data loss to roughly one
backup interval; it does not guarantee a backup every 24 hours. The freshness check uses the same
scheduler, so a GitHub outage can delay both jobs. GitHub may disable scheduled workflows in an
inactive public repository; check that this workflow remains enabled during routine operations.

Failures use GitHub Actions failure notifications. The maintainer who enables or last edits the
schedule must enable Actions email notifications in GitHub settings and verify receipt of a failed
manual run. Notification delivery is separate from a successful backup or restore test. Inspect
recent workflow runs to confirm the schedule remains active.

Before promoting schema changes, run `pnpm check`, which includes a complete schema snapshot and
local restore test. Capture remains one atomic read, with a 95,000-byte query-size guard. If the
schema exceeds that guard, review the snapshot query generator before release; do not bypass the
limit or split capture into separately timed reads. A failed capture must not publish a success
receipt.

## Credentials and access

Use dedicated credentials in these GitHub environments. Restrict each environment to the `main`
branch, with no tag patterns. Do not use repository-wide secrets or production deployment tokens.

| Environment             | Configuration                                                                                 | Purpose                                     |
| ----------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `member-backups`        | `D1_READ_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` secrets; `AGE_RECIPIENT` variable | Read production and write encrypted backups |
| `member-backup-read`    | R2 read-only access key and secret                                                            | Check freshness without access to plaintext |
| `member-backup-restore` | R2 read-only access key and secret; `AGE_IDENTITY` secret                                     | Quarterly decryption and isolated restore   |

Create an account-owned Cloudflare token with only **D1 Read** on the LVBT account. This permission
covers that account's D1 databases; the backup tool fixes the production database ID in code. Create
R2 object read/write and object read-only credentials scoped only to `lvbt-member-backups`. The
daily job receives only the public age recipient (the key used to encrypt files), never the private
recovery identity (the key needed to decrypt them).

Keep an owner-only recovery identity outside GitHub and the bucket, with a recovery copy accessible
to the organization's authorized maintainer. Losing all copies makes backups unrecoverable. To
rotate, securely retain the old identity until all backups encrypted to it expire, then update the
recipient and restore identity together. Rotate provider credentials in their environments and
revoke old tokens after a successful manual backup, freshness check and restore test. Never put
credentials or database files in Git, Actions artifacts, caches, comments or logs.

## Run a backup or restore test

Open **Actions → Member database backups → Run workflow**, select `main` and choose `backup`,
`check` or `restore-test`. A successful run prints aggregate results only. The restore test
downloads from R2; it does not rely on the backup job's local files or database access.

For a private workstation test, install Python 3.12 or newer and age, create a Python virtual
environment, then install the locked requirements:

```sh
python3 -m venv /private/path/backup-tools
/private/path/backup-tools/bin/pip install --require-hashes --only-binary=:all: -r packages/member-backups/requirements.txt
```

Load the appropriate credentials from secure storage into the environment variables above. Use
`D1_READ_TOKEN` and writer credentials for `backup`, or read-only credentials and `AGE_IDENTITY` for
`restore-test`:

```sh
/private/path/backup-tools/bin/python -B packages/member-backups/src/backup.py backup
/private/path/backup-tools/bin/python -B packages/member-backups/src/backup.py check
/private/path/backup-tools/bin/python -B packages/member-backups/src/backup.py restore-test
```

A retained backup has an encrypted `.age` file and a matching `.age.json` receipt that identifies
and checks the saved file. To test an older copy, select its receipt from the private bucket and
pass its complete `production/…` object key with `restore-test --receipt`. The tool refuses expired
backups, wrong database targets, invalid receipts, unsafe archives and existing restore
destinations. It restores with reviewed code and never executes scripts from an archive.

## Recover production after an incident

A quarterly test proves the archived database can be reconstructed in isolation. Production cutover
requires incident-specific review; measure elapsed recovery time during a controlled exercise. Do
not overwrite production to test a backup.

1. Pause member writes, outgoing mail and role synchronization. Preserve the current database and
   record the incident boundary in private operational notes.
2. Select a backup preceding the incident. Download its ciphertext and receipt into an owner-only
   directory, verify the file against the receipt's SHA-256 checksum and decrypt with the separately
   held identity.
3. Restore into a new isolated SQLite database using the reviewed `snapshot.restore` function. Check
   integrity, foreign keys and exact typed values before considering an import.
4. Reconcile all deletions, consent withdrawals and access revocations since the backup from current
   records and authoritative sources. If current records are lost, keep affected people suppressed
   until their current consent is established. Older backups must not reactivate them.
5. Invalidate restored sessions, sign-in codes, OAuth state and pending synchronization or delivery
   jobs. Review schema compatibility with the selected application release. Verify member access and
   current consent in an isolated application with external effects disabled.
6. Have the maintainer approve the prepared replacement and cutover. Keep outbound actions paused
   until provider verification confirms recovered state and access controls. Measure recovery time
   and record concise results privately.

## Troubleshoot failures and control costs

A failure never publishes a success receipt until it downloads and verifies the encrypted upload. An
older receipt remains visible to the freshness check. Inspect credentials, account access, lifecycle
settings, receipt age and provider availability without copying member data into logs. Retry
manually after correcting the cause.

D1 HTTP failures print a JSON diagnostic with the event `member_backup_d1_http_error`, HTTP status,
a fixed category and numeric Cloudflare error codes. They never print provider messages, SQL or
member values. Use the category to choose the next step:

- `database_daily_quota` means the provider explicitly reported a daily D1 limit. Check the
  account-wide row totals and scheduled-work limits. Preserve the existing archive, stop repeated
  capture attempts and retry once capacity is available after the UTC daily reset. A successful
  `check` verifies an existing archive; it does not create a new backup.
- `provider_authorization` means HTTP 401 or 403. Verify the dedicated `D1_READ_TOKEN` permission
  and LVBT account scope in the `member-backups` environment. Follow the credential authorization
  and rotation procedure above before retrying.
- `provider_http_error` means the tool could not classify the response. Check Cloudflare service
  health and the HTTP status. Error code 7500 alone does not establish quota exhaustion. Keep raw
  response bodies out of public logs and investigate through authorized provider tools.

A failed capture does not satisfy a pre-migration backup requirement. Resolve the failure and verify
a successful `backup` receipt before continuing a release that requires a fresh capture.

The backup stops when the table definitions, response size, or SQLite features exceed the supported
format. It does not save a partial backup. Generated or virtual tables and values that cannot
round-trip exactly require a reviewed format change; do not omit them to make a run pass. Keep
restore tests aligned with schema changes.

Standard GitHub-hosted runners are free for this public repository. R2 Standard includes a shared
free allowance; usage must fit alongside other buckets. Keep 30-day retention enabled, avoid
unnecessary duplicate backups and review usage as the database grows. No additional Worker or paid
backup service is required. See [R2 pricing](https://developers.cloudflare.com/r2/pricing/) and
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
