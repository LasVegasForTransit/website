# Background membership work

This reference explains the rules contributors must preserve when changing the jobs app. Use the
[jobs README](../../apps/jobs/README.md) for setup and local commands. Maintainers should use
[staff setup and release](staff-portal-operations.md) for hosted configuration and activation.

## Scheduling and progress

Production is configured for one scheduled invocation per minute after launch. Preview has no
recurring schedule. Preview launch and resume reject a saved release that would restore one.
Request-driven preview integrations can still run; automatic preview checks and retention wait while
its schedule is off.

The scheduler splits work into smaller Worker calls for retention, scans, incoming choices, account
changes and completion. Each call has a 50-statement database limit; each statement in a batch
counts. The parent call and child calls share a 32-invocation limit. Completion has a reserved call.
The coordinator stops starting optional work after 50 seconds. A running step can finish; queued
work remains for the next invocation. The daily database reservation can stop work earlier. See
[database capacity](staff-availability.md) and
[scheduled database checks](staff-background-work.md#keep-background-work-within-the-shared-database-allowance).

Incoming choices run before outgoing changes. The coordinator can run up to six incoming batches;
each incoming pass handles at most three ready events. Future-dated events wait without blocking
ready events. Newsletter roster pages contain at most 100 subscriptions. The current coordinator
starts at most three newsletter scan pages per tick. It saves the page position so a restart can
resume the scan. Provider pauses persist across restarts and apply to scans and account changes.
Saved incoming choices can still apply while provider requests are paused.

The scheduler shares remaining account calls between enabled providers. One provider's failure does
not suppress the other provider's work, but the scheduled invocation still reports failure. Read
[the schema](../../packages/platform-storage/migrations/schema.md) for persisted wakes, selection
pages, account leases and receipt rules. A lease lets one Worker process an account for a limited
time. A receipt records a confirmed result. A generation identifies the current revision of
membership or assignments so older work cannot overwrite it.

## Discord changes and cleanup

A Discord account step changes at most one managed role, reads it back and saves the confirmation.
An interrupted step retains its queued work. The complete pass saves the full current snapshot in
one guarded database statement. Recovery checks interrupted changes before marking work complete.
The Worker preserves roles that LVBT does not manage.

A member who disconnects Discord sees “Disconnecting Discord” until all managed role removals are
confirmed. Scheduled work continues without another submission. Disconnecting neither removes the
person from the Discord server nor ends LVBT membership.

Approved activation also registers the server-only `/link` command. The Worker saves completion only
after reading the command back from Discord. Completed definitions are skipped. Failed registration
retries no sooner than 30 minutes and respects longer saved rate limits. A command registration
failure does not stop membership processing. See
[command setup and repair](platform-secrets.md#register-the-link-command).

Each periodic scan queues checks for up to 100 live people with exactly one verified Discord
account, including former members. It resumes after restarts and starts its next scan at the next
UTC hour after completion. A scan proves that accounts reached the queue; it does not prove that
Discord checked every account within that hour. Unlinked server accounts use the separate roster
review described in the schema and operator guide.

Deletion replaces earlier work with removal tied to the original deletion timestamp. Cleanup must
not recreate profiles or access observations. Merge archives use separate jobs and ownership rules;
an archived person's delayed cleanup cannot remove the surviving person's access. Undo invalidates
old work. Completing archived work across providers remains an open implementation constraint.

## Newsletter consent and erasure

An active provider subscription never creates consent by itself. A paused or undeliverable
subscription does not end membership. Incoming changes preserve the original choice time. Unreadable
addresses, mismatches and an unsubscribe that cannot be ordered against a same-second signup require
review. Database failures leave the original work pending.

Ordinary withdrawal and reversible archives unsubscribe only. Account erasure must unsubscribe,
permanently delete each owned subscription and confirm absence with a separate lookup. Saved
subscription IDs and temporary encrypted addresses allow recovery after interrupted creation or
profile removal. Failures retain the minimum recovery data. See
[newsletter configuration and conflict policies](staff-newsletter-operations.md#scheduled-newsletter-processing)
and
[erasure recovery](staff-newsletter-operations.md#verify-newsletter-cleanup-after-account-deletion).

## Retention

Maintenance expires welcome claims and removes at most 100 entries per category by default.
Record-view retention is one calendar year; staff-audit retention is three calendar years. Entries
exactly at the cutoff remain. Separate profile cleanup erases legacy deletion copies and physically
removes erased profiles strictly older than 30 days. Reversible merge archives remain protected.
Selection, cleanup and temporary deletion permission share a transaction so failures roll back.

After 03:00 Pacific, a separate daily pass checks inactive profiles against a fixed 18-month cutoff.
Any consent, including a withdrawal, any non-check-in identity, or recent activity protects a
profile. Incomplete batches keep that day's cutoff; completed days do not repeat. Follow
[member-data retention](../guides/operate-member-data-retention.md) for the full eligibility rules.

## Local test coverage

The compiled fixtures use separate storage and simulated providers. They send no member records to
Beehiiv or Discord. They cover these failure and recovery cases:

| Fixture                     | Cases                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled Discord           | Grants, readback, fresh-confirmation skipping, withdrawal, external role changes and removal after a profile has been purged.                                                                                  |
| Newsletter                  | Signup, repeats, withdrawal, interrupted creation, profile erasure, permanent provider deletion, separate absence lookup and encrypted-address cleanup.                                                        |
| Incoming newsletter choices | Signed intake, replay, membership changes, Discord removal, unreadable-address review and rejection after erasure. A 5,000-account roster advances across seventeen successful ticks with a pause and restart. |
| Free-plan newsletter        | Polling without webhook credentials, external unsubscribe without an invented choice time, later explicit rejoin and closed signed intake.                                                                     |
| Staff newsletter review     | Both compiled Workers communicating through their private service connection.                                                                                                                                  |
| Maintenance                 | Daylight-saving boundaries, exclusions, bounded batches, deletion receipts and rollback.                                                                                                                       |

Local results do not establish hosted processor limits, daily account capacity, live provider
readback or deployed migration state. Provider cleanup for Google and other systems needs its own
orchestration and access audit. Retiring all detached keys and external IDs remains dependent on
confirmed completion by every provider.
