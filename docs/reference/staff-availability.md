# Staff availability

Maintainers use this reference to measure staff access, investigate failures and verify recovery.
The target is **99.9% availability over a rolling 30 days**. This allows 43 minutes and 12 seconds
of unavailability. This target is an operational SLO; it does not establish a contractual SLA or
prove that production already meets it.

## Measure the task people need

Measure whether an authorized person can sign in, open Members and search for a member. A successful
Cloudflare Access redirect or a rendered recovery page does not establish availability. Count server
errors, timeouts and failed database-dependent reads as unavailable. Exclude deliberate refusals for
unauthorized accounts. Check mutations separately with an approved synthetic account and reversible
fixtures; never create real membership or consent changes just to monitor uptime.

Use an external probe every 60 seconds through the normal protected sign-in path. Alert the
responsible maintainer after two consecutive failed checks. Retain probe outcomes and Worker error
counts for the same 30-day window. Include failures before requests reach the Worker. Keep probe
credentials private and preserve Access, session and staff authorization checks.

External authenticated probes and alerts require a configured identity, scheduler and recipient. The
application changes do not provision those services. Until maintainers verify that setup and collect
results, report availability as unmeasured. Worker logs alone omit edge and sign-in failures.

## Remove the recurring capacity failure

Cloudflare D1 Free limits the whole account to 5 million rows read and 100,000 rows written per day.
Production, previews and operator work share that limit. The allowance resets at 00:00 UTC.
Cloudflare rejects database work once the allowance runs out. A styled recovery page cannot restore
staff access. See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

Use Workers Paid for production capacity. Workers Paid removes D1's Free daily read and write
cutoffs. Its subscription starts at $5 per month and includes metered allowances and overages.
Maintainers must approve organizational billing before changing the plan. Query bounds, usage review
and alerts remain necessary on Paid. Neither plan alone proves this availability target. See
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Keep the observation-history index, erasure audit index and bounded provider selection migrations
with the matching jobs release. Retain ownership, consent, generation and erasure checks. Test real
D1 read costs with long histories and blocked queues before changing these paths. A returned-row
limit or statement budget does not bound the rows SQLite scans.

## Verify a recovery

Follow
[staff operations](staff-portal-operations.md#keep-background-work-within-the-shared-database-allowance)
for account usage, backups, canonical migrations and the protected release flow. Preserve the
selected release and existing deployment receipts. Stop manual retry loops during exhaustion.

After release, verify real authorized sign-in, member search and provider processing. Inspect
`job_database_usage` records across scheduled ticks and compare them with account-wide D1 usage over
a full day. Confirm that unknown metadata is not reported as zero usage. Confirm that a quota error
stops the remaining steps in that invocation. Do not claim a persistent cooldown across cron
invocations because this implementation has no independent shared circuit state.

Record the deployed version, migration verification and aggregate availability privately. Keep
member data and credentials out of public incident notes. If production checks fail, follow the
saved-release recovery procedure and preserve evidence before making another publication attempt.
