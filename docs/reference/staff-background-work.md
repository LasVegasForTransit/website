# Staff background work and database limits

Maintainers use this reference when scheduled jobs consume too much database capacity or stop
processing queued work. Check account usage before retrying. Cloudflare D1 is the shared SQL
database; a wake is a saved signal that tells the jobs Worker to check a category of work.

Use [staff availability](./staff-availability.md) for the daily budget, local cost limits and
availability target. These procedures require authorized read access to the selected Cloudflare
account and database. Database changes and releases still use the backup and protected release
procedures.

Choose the section for your task:

- [Keep background work within the shared database allowance](#keep-background-work-within-the-shared-database-allowance).
- [Inspect scheduled wakes](#inspect-scheduled-wakes).

## Keep background work within the shared database allowance

Cloudflare's [D1 pricing reference](https://developers.cloudflare.com/d1/platform/pricing/) defines
the Free plan's account-wide daily row allowance and midnight UTC reset. Production, preview,
imports, backups and console queries share that allowance. Count rows scanned by writes and triggers
as well as reads; limiting query count or returned results does not bound scanned rows.

1. Open **Cloudflare → Storage & databases → D1 SQLite Database → Daily**. Check account-wide rows
   read and written before an import, migration or release. Keep the existing Free plan. Reserve
   allowance for staff and member requests, and defer bulk work when remaining capacity is low. A
   reliability request does not authorize a billing change.
2. Open the selected environment's membership database's **Overview → Queries**. Compare **Count**,
   **Rows read** and **Rows written** for the same time range. A frequently executed write with high
   read volume can indicate an expensive trigger. Preserve only concise diagnostics privately,
   without member data.
3. For Discord observation inserts, verify migration **0048** is installed. Its provider-resource
   index lets the mismatch trigger find newer observations without scanning that person's retained
   history. Do not drop the trigger, erase observations or remove ownership checks to reduce usage.
4. Successful Discord work waiting for another provider is revisited hourly. Five-minute account
   observation expiry controls what the portal can confirm; it does not require repeating unchanged
   background work every five minutes. New membership changes, disconnects and failed work remain
   eligible promptly. An accepted staff retry also rechecks Discord promptly while preserving other
   providers' receipts. Shared completion still requires its existing provider checks.
5. Profile maintenance uses indexed candidate checks before assembling erasure and purge work.
   Migration **0049** indexes audit targets so due erasure does not scan unrelated audit history. An
   idle tick skips the full cleanup batch. Due work keeps its existing batch limits and resumes on
   subsequent ticks; immediate account erasure and retention rules remain in force. Records cleanup
   runs on the UTC hour, with limited batches of expired claims, stale snapshots and expired audit
   records. Expiration checks on reads remain mandatory. Monitor old records left after each batch;
   a backlog continues on later minute ticks after migration **0053**. Profile cleanup and access
   removal queues wake from accepted changes.
6. Migration **0050** gives provider selectors fixed pages: 16 urgent removals, 16 other explicit
   changes and 32 periodic operations per call. Each selector advances its own cursor atomically
   with its eligibility checks. Blocked work cannot force a scan of the whole queue. A large backlog
   within one lane takes multiple calls to revisit. Apply the migration before activating the
   matching jobs release; the backfill and index creation themselves consume database allowance.
7. Migration **0052** indexes the parsed creation date used by inactive-profile retention. Apply it
   before verifying the daily privacy run. It preserves date-offset comparisons and every consent,
   identity and engagement exclusion. Provider cursor claims skip unchanged values, so empty queues
   do not rewrite their cursors on each minute tick.
8. Migration **0053** adds saved wake signals, scan-progress markers and due-time indexes. Apply it
   after **0052** and before activating its matching jobs release. The additive migration starts
   existing queues awake and backfills receipt deadlines for active operations only. Index creation,
   the deadline backfill and initial wake rows consume allowance, so use the verified backup and
   reviewed migration workflow. Do not create a separate schema in the dashboard. Keep the wake
   table, triggers and indexes during code rollback; older code ignores them safely.
9. Run `pnpm -C apps/jobs test` and `pnpm -C packages/platform-storage test` locally. The real local
   D1 tests measure observation and idle-maintenance rows read with long histories; storage tests
   cover a full day of cross-provider scheduling and immediate membership changes. These tests use
   synthetic, local data. Do not run the fixtures against production or preview databases.
10. If the daily allowance is exhausted, stop manual retries and keep the selected saved release.
    Wait for the documented reset. Afterward, make one availability check, take the required backup,
    apply the selected release's migrations through the normal release flow, then activate the
    matching protected staff/jobs build. Recover uncertain deployments through their receipts. Do
    not bypass database gates, toggle production schedules in the dashboard or upgrade the plan
    implicitly.
11. Inspect `job_database_usage` records for each scheduled database job. Each record includes
    executed statements, `rows_read`, `rows_written`, `metadata_missing`, `database_errors` and
    `quota_exhausted`. Missing metadata or a failed query means the row totals are incomplete; do
    not treat them as a daily account total. A recognized D1 quota failure stops subsequent database
    work in that invocation and aborts the remaining scheduled steps. Migration **0051** adds a
    durable daily reservation for scheduled work. Missing usage or an overrun closes that database’s
    background work through the next UTC reset. If D1 rejects the guard itself, no provider jobs
    run. This budget does not account for staff/member requests or other databases. See the exact
    caps and
    [deferral recovery procedure](staff-availability.md#reserve-database-capacity-for-people).
12. After release, inspect actual row usage over several scheduled ticks and again over a full day.
    Leave headroom for member/staff traffic, imports and backups. Confirm sign-in, member search and
    provider processing separately. Passing local budgets does not establish a healthy live day.

## Inspect scheduled wakes

Maintainers need read access to the selected database and its active release before diagnosing a
wake. Use the normal read-only database tools to run:

```sql
SELECT name, revision, next_run_at, configuration FROM scheduled_work_signals ORDER BY name;
SELECT utc_day, charged_reads, charged_writes, lease_until, blocked FROM scheduled_work_budget;
SELECT operation_id, provider, observed_at, expires_at FROM scheduled_receipt_deadlines
ORDER BY expires_at LIMIT 20;
```

Expect four signal rows. The configuration contains public provider identifiers and the command
fingerprint; it contains no credentials. An overdue signal can mean queued work, an unfinished
batch, a held budget lease or a closed daily budget. Inspect the corresponding sanitized job logs
and queue before changing anything. Do not clear the signal or reset the budget to make the
dashboard look healthy. A new member change can update the wake's revision number while a job runs.
The running job must acknowledge only the older revision it started with, so it cannot clear the
newer request. Repeated checkpoint writes during a provider pause indicate a regression. The receipt
deadline index must contain only queued, running or retry operations with a completed provider
receipt. Completed operations must not keep deadlines in this index. The saved confirmations from
each provider still control authorization and completion; never edit the deadline index to change
access evidence.

D1's affected-row count includes writes made by database triggers, which run automatically when
other rows change. A guarded single-row mutation succeeds when its change count is positive. Task
counters use returned task IDs rather than that metadata. The local storage test database models
trigger-inclusive counts, and the compiled provider tests verify lease ownership and same-invocation
processing after scans.

After activating the matching release, compare actual D1 account usage and job counters over several
ticks and a full UTC day. Run the local idle-hour regression when changing triggers, queue
selectors, checkpoint timing or maintenance categories. The expected local budgets and scheduler
component diagram are in
[staff availability](staff-availability.md#reserve-database-capacity-for-people).
