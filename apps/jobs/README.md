# Scheduled membership work

This Worker performs bounded profile and audit retention and processes pending Discord membership
and committee role changes once a minute. It has no public HTTP API. The production and preview
configurations keep synchronization disabled until maintainer setup and live verification are
complete.

Shared reconciliation work is marked done only after every verified linked provider has a fresh
success receipt. A missing provider link needs no receipt; an enabled identity with no current
confirmation keeps the operation open for its provider runner.

## Local verification

Run from the repository root:

```sh
pnpm check
pnpm -C apps/jobs test:maintenance
pnpm -C apps/jobs test:e2e
pnpm -C apps/staff test:discord-observation
```

The scheduled test executes the compiled Worker against isolated storage and a synthetic Discord
server. It verifies grants, a subsequent read, fresh-confirmation skipping, automatic role removal
after consent withdrawal or deletion, and repair of externally changed roles on completed accounts.
Deletion removes stored access confirmations and profiles; successful cleanup cannot restore them.
The scheduled fixture advances the maintenance clock beyond thirty days and proves Discord removal
still completes after the personal profile has been physically removed. The staff test verifies that
an actual adapter result appears as a confirmed Member role, becomes invalid immediately after
withdrawal, and later shows confirmed removal. Neither test connects to Discord or proves live
server operation.

## Configuration and release

Both jobs and staff read the public Discord configuration declared in the
[Worker runtime configuration](../../packages/platform-integrations/src/worker-runtime-config.ts).
Jobs additionally needs the approved bot token; staff receives no bot token. Preview must use a
separate server and database. See
[platform setup](../../docs/reference/platform-secrets.md#scheduled-discord-configuration).

The current website bootstrap and promotion workflow do not provision these two Workers. Release
wiring, migration application and live server acceptance remain open. Run `pnpm staff:preflight` for
a read-only configuration inventory and follow the
[staff setup and release instructions](../../docs/reference/staff-portal-operations.md). Migrations
are canonical in `packages/platform-storage/migrations`; do not apply them to production from an
agent session.

Durable application pauses prevent a new Worker instance from bypassing Discord rate limits. Account
leases and current generations protect concurrent grants and removals. Each provider owns its own
receipt: successful Discord work cannot finish a job whose Google or mailing-list work is unproven.
Never-confirmed members precede expired confirmations in the bounded queue.

## Periodic Discord checks

Each scheduled invocation also scans up to 100 live people with one verified Discord account,
including former members. A persisted server-specific checkpoint resumes unfinished scans across
invocations and Worker restarts. After completion, the next scan starts at the next UTC hour.
Accounts whose previous work has finished receive current-generation reconciliation jobs; existing
pending work and deferred retries are reused. Scanning does not change membership or assignment
generations. Lease and transaction guards prevent expired workers from advancing another scan.

Storage tests cover 5,000 linked accounts across 50 bounded batches, rollback, concurrent workers,
server isolation and membership changes during selection. This proves local queue coverage. The
dispatcher separately attempts up to 25 accounts per minute within its time budget and honors
persisted rate limits. Completing a scan does not prove that all accounts have been checked against
Discord within that hour; live throughput remains a release gate. Unlinked server users are outside
this scan.

## Deleted and combined records

Ordinary deletion atomically replaces old work with cleanup bound to that deletion's timestamp. The
runner removes managed roles from the retained verified account, then saves its independent receipt
without saving personal profiles or access observations. Failed queue writes roll back erasure;
provider failures retain a retry. Repeated deletion preserves the original binding. Migration 0020
also queues previously deleted accounts and clears their old access confirmations.

Merges retain their separate jobs and transfer identity ownership to the surviving record. They do
not create ordinary deletion work. Current ownership and generation checks prevent an archived
record from revoking its survivor's account; undo invalidates old jobs. Local adapter tests cover
merge, undo and subsequent withdrawal. An archived record without an account is excluded from
Discord selection; completing its shared work across other providers remains unresolved.

## Confirmed Discord access changes

Before changing a role, the runner saves a bounded intent containing stable IDs, current
generations, reason and requested staff operation. It records a grant or removal in the shared staff
audit log only after a validated server read confirms that state. A timed-out write or partial
failure can be confirmed by a later read without duplicating the event. Failed intent persistence
prevents the remote write; failed audit persistence preserves the intent for recovery. Unchanged
reads create no access-change entry. Administrators can see these entries on the member profile; the
account-updates page uses the same log with current committee permissions.

Local tests cover actual bounded timeouts, partial writes, persistence rollback, replay, deletion
privacy and configured compiled staff rendering with JavaScript disabled. The scheduled Worker
records confirmed grants and deletion removals against isolated provider fixtures. These checks do
not establish live Discord behavior.

## Profile retention, audit retention and expired claims

Each scheduled invocation first expires welcome claims and removes up to 100 records per category:
record views older than one calendar year and shared staff audit entries older than three calendar
years. Entries exactly at the cutoff remain. This work runs independently of Discord configuration.
It logs counts only and preserves active member records and engagement history. Maintenance also
erases up to 100 legacy ordinary deletion roots and physically removes up to 100 erased profiles
strictly older than thirty days. Reversible merge archives are protected. A combined deletion group
is erased together rather than split by the root bound.

Migration 0022 protects audit deletion with a maintenance scope created and removed inside the same
atomic batch. Each deletion must also satisfy its own age cutoff. Direct deletion and ordinary
updates are rejected; explicit profile erasure can only redact associated staff-audit details while
retaining attribution, action and time; failed batches restore removed rows and leave no deletion
scope. Unit tests exercise exact cutoffs, leap-day normalization, bounded repeats, renewed claims
and rollback. The compiled Worker proves bounded actual D1 deletion, repeat safety and deletion
rejection with Discord disabled and no external requests. Migration 0025 keeps only opaque person
keys for pending provider work and other records’ attribution after profile removal. Retained
verified account IDs and current generations allow access removal to finish; they cannot recreate a
member profile. Existing provider receipts and pre-write intents survive the migration. Run
`pnpm -C apps/jobs test:maintenance` after the repository build.

Complete merge/provider orchestration, Google/mailing-list orchestration and the common access audit
writer for Google, GitHub and onboarding remain unfinished. Hosted export acceptance, full
retirement of detached keys and external IDs after every provider completes, old unconfirmed intent
retention and live provider acceptance also remain open. Migrations 0019–0025 have not been applied
to production.
