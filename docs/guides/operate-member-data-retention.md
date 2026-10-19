# Operate member data retention

Use this guide to verify member-data erasure, daily inactive-record cleanup, and Google account
review. It helps a maintainer confirm that personal data disappears locally while unfinished
provider cleanup stays recoverable.

## Before you start

- Complete [staff preview setup](./set-up-staff-preview.md) and the repository's local setup.
- Select the LVBT Cloudflare account and the intended environment. The examples below read only
  `lvbt-platform-preview`; production is `lvbt-platform` and requires its own authorization.
- Have approved read access to the selected D1 database (Cloudflare's managed SQLite database),
  administrator access to the protected staff portal, and any separately approved provider test
  accounts needed for live acceptance.
- Use synthetic members and isolated provider accounts in preview. Keep personal data and detailed
  execution receipts in the approved private operational record.
- Before a migration, [back up and verify the database](./back-up-membership-database.md). Apply the
  selected saved release's migrations through the staff preview procedure. Do not apply a newer
  checkout's migrations to an older deployed application.

## 1. Verify the schema and applications

From the repository root, list the preview database's installed migrations:

```sh
pnpm -C apps/staff exec wrangler d1 execute lvbt-platform-preview --remote --env preview --command "SELECT name FROM d1_migrations ORDER BY id"
```

Confirm that `0041_member_privacy_maintenance.sql` and `0045_scheduled_read_budget.sql` are
installed alongside every earlier canonical migration before enabling scheduled maintenance. The
latter adds an index that keeps legacy erasure from repeatedly reading already-erased retained
profiles. The website, staff portal, and jobs Worker must use that same environment's database and
compatible saved applications. A Worker is a backend application running on Cloudflare; see the
[glossary](../reference/glossary.md). A missing migration or mismatched application is a release
blocker. Use the
[release recovery procedure](../reference/staff-portal-operations.md#recover-a-failed-preview-activation)
instead of changing tables by hand.

For local acceptance, run these commands after building the selected applications:

```sh
pnpm check
pnpm -C apps/jobs test:maintenance
pnpm -C apps/jobs test:e2e
pnpm -C apps/staff exec node --import tsx tests/e2e/workspace-offboarding.spec.ts
pnpm -C apps/staff exec node --import tsx tests/e2e/person-deletion.spec.ts
```

The fixtures use isolated databases and simulated providers. They cover irreversible erasure,
bounded cleanup, retained retry work, and the actual review form. Passing them does not establish
hosted scheduling or provider deletion.

## 2. Check the daily inactive-record pass

The jobs minute schedule starts the daily pass at **03:00 America/Los_Angeles**. It follows Pacific
daylight-saving time. Each invocation selects at most 100 roots, and later ticks resume an
unfinished day. Once the day is complete, further ticks perform only a completion check. The cutoff
stays at that day's 03:00 minus eighteen calendar months, clamped to the last valid day of a shorter
month.

A live record qualifies only when it was created before the cutoff, has no consent record in any
scope, has no withdrawal evidence, has no linked identity other than a check-in identity, and has no
engagement at or after the cutoff. An unreadable engagement date prevents automatic erasure. The
current identity schema does not offer a check-in identity type, so every currently supported linked
identity excludes a record. Withdrawn consent also excludes a record regardless of its age. The pass
does not infer eligibility from membership status alone.

In the approved private database console, inspect the daily run without printing member details:

```sql
SELECT local_day, cutoff_at, last_attempt_at, completed_at
FROM member_privacy_runs ORDER BY local_day DESC LIMIT 7;
SELECT reason, count(*) AS deletions FROM person_deletion_log GROUP BY reason;
```

For example, an August 31 run can use February 28 of the previous year as its cutoff. A completed
daily row means that selection drained for that day. A row without `completed_at` means another
bounded batch is needed. An empty day still records completion. Verify the next tick advances an
unfinished day; do not mark it complete manually. The jobs schedule must be enabled through the
reviewed launch procedure. A setup release with schedules disabled cannot prove daily operation.

## 3. Verify an approved deletion

For a member deleting their own account, use the member account's deletion flow with a synthetic
preview member. For staff-assisted deletion, use the procedure below. Never delete a production
member or the final preview administrator as a test.

### Delete a member as an administrator

You need current LVBT membership, staff administrator access, and authorization to delete the
selected record. The `person.delete` permission is administrator-only; a committee lead cannot open
or submit this action.

1. In the selected staff portal, open **Members**, find the synthetic test member, and open their
   profile. Choose **Edit details**, then **Delete member** below the editing form.
2. Check the name and email on the confirmation page. Read the consequences before proceeding:
   deletion ends membership, clears local personal data and saved activity, ends sessions, and
   queues the existing newsletter and member-access cleanup. A Google account note appears only when
   that member has a linked Google account. The account and shared files require administrator
   review; this action does not delete either. A combined-record notice appears when erasure will
   also cover records combined with this member.
3. First select **Cancel**. Confirm that the profile still exists and no deletion receipt was
   created. Reopen **Edit details → Delete member** to continue the test.
4. Select **Delete member** on the confirmation page. There is one confirmation form, with no name
   re-entry, reason field, or extra checkbox. A successful request returns to **Members** with
   **Member deleted.** The deleted profile can no longer be opened.
5. Verify that another test member's profile and access remain unchanged. Repeat the old submission
   only in the synthetic fixture: it must not create another deletion or affect another person.

The form expires after thirty minutes and can be used only once for that selected member. Current
administrator authority, the member's record version, and preservation of an active administrator
are checked again inside the erasure transaction. If the record changed, review its latest details
through **Review deletion again** before deciding whether to submit a fresh confirmation.

If a connected account changes during confirmation, the staff action also rolls back and asks for
another review. It does not repeat erasure automatically. Reopen the confirmation after checking the
member and their current accounts. If administrator access was withdrawn, sign in with a currently
authorized account instead; an old confirmation cannot preserve former permissions.

The final active administrator cannot be deleted, even when another former member still has an
administrator designation. Use [Manage staff administrators](./manage-staff-administrators.md) to
add another approved current administrator first. Verify that person can sign in, then reopen the
deletion confirmation. If you delete your own record while another active administrator remains,
your sessions and cookies are cleared. You return to sign-in with confirmation that your member
record was deleted.

### Verify erasure and connected-service cleanup

Confirm that the member can no longer sign in and that the profile's contact fields, consent,
engagement, private account profiles, saved corrections, and affected merge copies are removed. An
erased merge cannot restore those details through undo. Record only the opaque member key in the
private acceptance record.

Inspect that key's `person_deletion_log` receipt privately. `requested_by` is `member` for the
self-service flow, the authenticated staff actor's opaque key for a staff request, or `retention`
for automatic maintenance. `requested_at` preserves the request timestamp captured in the erasure
scope. `completed_at` records completion of the local irreversible erasure transaction. It does
**not** confirm deletion in Beehiiv, removal of Discord access, review of a Google account, or
expiry of a backup. Names and email addresses never belong in the log.

Migration-created historical receipts use `requested_by=retention`, `reason=legacy`, and the stored
erasure timestamp as `completed_at`. Their `requested_at` is null because the original request time
is unknown. They document the retained legacy erasure, not a recovered original human requester or
newly observed completion time. Keep that limitation in any acceptance report.

The regular minute maintenance pass physically removes erased profiles strictly more than thirty
days after their deletion time. It keeps the opaque person key and deletion receipt. Verified
provider identifiers, cleanup jobs, and minimum recovery evidence survive that purge so failed or
interrupted cleanup can finish. Reversible merge archives remain protected from ordinary purge.

Follow
[newsletter cleanup after deletion](../reference/staff-portal-operations.md#verify-newsletter-cleanup-after-account-deletion)
to verify Beehiiv's permanent deletion and separate absence lookup. Confirm Discord role removal
through the configured provider readback. A pending provider job is unfinished cleanup, even when
the local deletion receipt exists.

## 4. Review a linked Google account

1. Sign in to the selected staff portal as an administrator. Open **Members → Google accounts to
   review**, or `/offboarding/` directly.
2. Review why each account was flagged: membership ended or member data was deleted. After erasure,
   only the retained Google account identifier is available. Open the linked **Google Admin**
   console in the correct organization's account and locate that account using the identifier.
3. Decide whether any separately authorized account or file work is needed. This application does
   not delete a Workspace account or its files. Follow the organization's approved account procedure
   for any external action; marking a review supplies no authorization for it.
4. Select **Mark reviewed** after completing the human review. The page confirms **Review recorded**
   and removes that flag from the pending list. The account identifier remains retained for cleanup
   and attribution. The receipt records the reviewing administrator and time.
5. Reload the page to verify the flag stays resolved. A later membership-ending event or erasure
   creates a new revision requiring review. An older form or repeated submission cannot dismiss that
   later revision.

The queue and review action recheck current administrator membership in storage. A committee lead
cannot access them. The form works without JavaScript and uses a single-use token bound to the
account's current revision.

## 5. Recover failed or interrupted work

- **The daily row is unfinished:** inspect the jobs failure privately and correct the named schema,
  runtime, or permission problem. Allow the next scheduled tick to resume. Failed batches roll back
  both erasure and the daily claim; completed bounded batches remain completed.
- **The day has no row after 03:00:** verify the deployed jobs version, database binding, and
  enabled minute schedule using
  [staff preflight](../reference/staff-portal-operations.md#read-only-configuration-check). A
  disabled schedule does not catch up until a later enabled run. Do not loosen eligibility or
  backdate member activity to make a test pass.
- **Provider cleanup is pending:** retain the verified identifiers, attempted writes, encrypted
  recovery data, and provider receipts. Follow the provider recovery procedure. Do not clear a job
  or mark it done because local erasure or thirty-day purge succeeded.
- **D1 reports daily read quota exhaustion (error 7500):** inspect the selected database's
  Cloudflare Metrics view and compare query counts with rows read. For an isolated Discord preview,
  use the
  [preview shutdown procedure](../reference/staff-portal-operations.md#shut-down-the-isolated-discord-preview)
  to stop the minute schedule while investigating. A result limit or query-count budget does not
  bound scanned rows. Confirm migration 0045 and the saved applications are installed together; an
  idle provider selection must not scan all profiles and opaque keys, and legacy erasure must seek
  only unerased deletions. Confirm migration 0048 as well: the newer-observation check in the
  Discord mismatch trigger needs its provider-resource index. An observation insert can otherwise
  scan the person's entire retained observation history even when its outer query uses indexes. Use
  the Queries table's **Rows read** column to identify expensive statements; include writes and
  their triggers, rather than counting only SELECT statements. Repeated roster dry runs cannot clear
  the account-wide quota. After quota recovery, verify low idle read usage over several scheduled
  ticks before accepting the repaired schedule; preserve pending privacy and provider work
  throughout.
- **The review form expired or changed:** reload `/offboarding/`, inspect the current flag, and
  submit its new form. If access is denied, verify current administrator membership rather than
  granting access through a submitted actor identifier.
- **A release failed:** recover the saved application through the release procedure. Erasure is
  irreversible. Do not restore an old member database over current deletion receipts or tombstones;
  any data recovery needs a separately reviewed plan that preserves subsequent deletions and
  withdrawals.
