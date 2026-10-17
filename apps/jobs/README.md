# Scheduled membership work

This Worker performs bounded profile and audit retention and processes incoming newsletter choices,
pending newsletter requests, and Discord membership and committee role changes once a minute after
launch. It has no public HTTP API. The production and preview configurations keep schedules and
synchronization disabled until maintainer setup and live verification are complete.

Shared reconciliation work is marked done only after every verified linked provider has a fresh
success receipt. A missing provider link needs no receipt; an enabled identity with no current
confirmation keeps the operation open for its provider runner.

## Discord command registration

Approved Discord synchronization activation also registers the guild-only `/link` command using the
bot token already installed on jobs. A durable checkpoint completes only after provider readback;
completed definitions are skipped on later schedules and restarts. Failed attempts retry no sooner
than 30 minutes, respecting longer persisted Discord rate limits. Registration errors leave
membership processing running. See
[command setup and manual repair](../../docs/reference/platform-secrets.md#register-the-link-command)
for the existing one-time CLI and live acceptance checks.

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

The newsletter fixture runs the same compiled scheduled Worker against an isolated Beehiiv API. It
checks signup readback, repeated dispatch, withdrawal, interrupted creation followed by profile
erasure, recovery and permanent deletion of the resulting subscription, a separate absence lookup,
and removal of its temporary encrypted address. It sends no member records to Beehiiv and does not
prove hosted provider operation.

The source-processing fixture sends signed newsletter changes through the compiled receiver and
scheduler. It verifies canonical membership and Discord role removal, unreadable-address review,
replay safety and rejection after erasure. Its 5,000-account roster advances in ten successful
scheduled ticks, with a provider pause and Worker restart between pages. Incoming choices still
apply during the pause. The fixture uses isolated Beehiiv and Discord responses, not live accounts.

The Free-plan fixture omits webhook credentials. It verifies roster polling, canonical signup and
withdrawal readback, an external unsubscribe changing membership without inventing a choice time,
and a later explicit signup rejoining. Signed intake remains closed. The staff newsletter-review
fixture runs both compiled Workers through their real private service binding. Both fixtures use
isolated responses and do not establish live provider acceptance.

## Daily member privacy maintenance

After03:00 Pacific, the scheduler starts a separate bounded inactivity pass. It resumes unfinished
batches using the same calendar day's cutoff and stops repeating completed days. Each call is
counted within the shared32-invocation allowance and has its own50-query limit. Records with any
consent, including a withdrawal, any non-check-in identity, or recent activity remain protected.
Ordinary30-day profile purge and provider cleanup still run independently. The compiled maintenance
fixture covers daylight-saving boundaries, exclusions, multi-batch completion, and deletion
receipts. See [Operate member data retention](../../docs/guides/operate-member-data-retention.md).

## Scheduled newsletter requests

Set `LVBT_BEEHIIV_SYNC_ENABLED=true` only after approved provider setup. Jobs requires
`LVBT_BEEHIIV_PUBLICATION_ID`, `LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID`, the encrypted
`LVBT_BEEHIIV_API_KEY` secret, and a dedicated `LVBT_NEWSLETTER_INTENT_KEY` secret. The intent key
is a base64url-encoded 32-byte random value used only by jobs to protect incoming addresses and
recover interrupted creation; never reuse a sign-in or provider credential. Ordinary hosted preview
keeps its selected publication blank and has no live Beehiiv key. Local tests use synthetic
publication IDs and provider fixtures; the preview guard rejects the real production publication.
Production must match its declared production publication. Missing or inconsistent configuration
disables newsletter work. Both source environments default to disabled.

Free-plan API work does not require a webhook key. Optional signed intake requires the selected
publication's valid `LVBT_BEEHIIV_WEBHOOK_SECRET` on jobs. The website's `POST /webhooks/beehiiv`
route forwards exact bytes and signature headers over its private jobs binding. Signing and
address-encryption keys stay on jobs. Configure a reachable, approved callback route before enabling
signed intake; do not remove protection from the preview site to make a callback work. See
[newsletter operation checks](../../docs/reference/staff-portal-operations.md#scheduled-newsletter-processing).
Missing or malformed signing credentials close intake without disabling API work or already saved
authenticated events. Free-plan status differences still require their own consent handling, staff
resolution and live acceptance before synchronization is enabled. LVBT uses
`LVBT_BEEHIIV_CONFLICT_POLICY=staff_review` for unclear changes: hold conflicting outgoing
subscription changes for staff review. Changing this policy requires a maintainer decision. A blank
value leaves that processing disabled. The supported values are `keep_unsubscribed` and
`staff_review`. The first policy closes consent at observation time for an unclear unsubscribe
interval; the second holds outgoing grants and leaves membership for staff confirmation. Both retain
review and preserve a newer explicit signup. Known earlier consent can be withdrawn under either
policy. An active API status never creates consent, and paused or undeliverable statuses do not end
membership.

Staff accesses newsletter follow-up through `LVBT_NEWSLETTER_JOBS`, bound to the jobs service in the
same environment. The fixed private review endpoint rechecks administrator membership for reads and
inside decision transactions. It selects the publication from jobs configuration and never accepts a
browser-supplied publication or actor. Staff receives neither provider credentials nor address
encryption keys. Review remains available while sending is disabled. A changed record, ownership or
administrator designation invalidates the submitted version without partial writes.

Each account pass resumes one target from the current durable request. Account ownership, consent,
generation and lease checks prevent older work from granting access after withdrawal. Roster polling
reads one page of at most 100 subscriptions, saves its cursor and resumes after restarts. Polling
stores provider observations without inventing consent timestamps. A publication-wide rate-limit
pause applies to both polling and account changes, including after a new dispatcher starts. Incoming
saved choices do not need a provider request and continue during that pause.

Account erasure unsubscribes each owned subscriber, permanently deletes it, and requires a separate
not-found lookup before confirming cleanup. Ordinary withdrawal and reversible archives only
unsubscribe. Migration `0039_newsletter_erasure_cleanup.sql` requeues previously completed erasures
so an earlier unsubscribe does not count as permanent deletion. Recovery includes stable subscriber
IDs retained in receipts for that person and publication, even after the personal profile is
physically removed. Provider failures retain the job and minimum recovery data. Follow the
[deletion procedure](../../docs/reference/staff-portal-operations.md#verify-newsletter-cleanup-after-account-deletion)
for isolated acceptance and failure recovery.

Each incoming pass handles at most three ready events from the selected publication. Future source
clocks wait without blocking other ready changes. Decryption or address mismatches require review;
database failures leave the original work pending for retry. A whole-second unsubscribe that cannot
be ordered against a signup inside that second also requires review and keeps outgoing work held.
Original choice times are preserved. No failure manufactures consent or silently subscribes someone
again.

The scheduled coordinator uses separate in-process Worker entrypoints for retention, provider scans,
incoming processing, account work and completion. Each entrypoint enforces the Free plan's
50-statement database budget; every statement in a batch counts. The coordinator processes up to six
incoming batches before outgoing changes and advances up to five newsletter roster pages per tick.
It shares the remaining account allowance between enabled providers and counts every call, including
the scheduled parent, within the 32-invocation limit. Completion always has a reserved call. A
failed provider step does not suppress the other provider, and failures still make the scheduled
invocation fail. Compiled fixtures and the local meter do not establish hosted CPU or quota
acceptance.

The coordinator stops starting optional work after fifty seconds. An in-flight step can finish, and
remaining work stays queued for the next invocation. Discord account steps change at most one
managed role, read it back, and record its confirmed change. Partial steps retain their account work
without claiming completion. They refresh member access and the changed committee; the complete pass
saves the full current snapshot in one guarded statement. Old interrupted confirmations also drain
in bounded passes before completion, preserving unrelated roles.

A member disconnect request uses the same bounded cleanup. While other managed roles remain, the
website returns to the account with “Disconnecting Discord.” The verified account stays connected
until every removal is confirmed; scheduled work completes cleanup without requiring the member to
submit the request again. Server membership and the LVBT membership record stay as they are.

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
dispatcher shares the remaining account allowance with newsletter work and honors persisted rate
limits. Completing a scan does not prove that all accounts have been checked against Discord within
that hour; live throughput remains a release gate. Unlinked server users are outside this scan.

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

Audit cleanup and profile cleanup run in separate entrypoints so unrelated maintenance cannot
exhaust the profile-erasure database budget. Each category retains its own atomic selection, cleanup
and scope removal. Profile erasure and physical removal are never split across transactions.

Launch acceptance also requires staff resolution of ambiguous newsletter changes, hosted export and
erasure checks, and live provider readback. Full retirement of detached keys and external IDs needs
every provider's cleanup to finish; unconfirmed intents must retain the minimum information needed
for recovery. Google and other providers require their own orchestration and access auditing. Use
the [operator reference](../../docs/reference/staff-portal-operations.md) for current configuration
checks and deployment prerequisites.
