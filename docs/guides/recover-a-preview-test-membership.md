# Recover a linked preview test membership

Use this guide when a synthetic preview member signs in but their profile cannot open because its
identifier is invalid. Recovery must preserve the linked Google account, consent evidence, and
administrator history so the tester can continue using the portal.

## Before you start

This is a maintainer procedure for **lvbt-platform-preview**, not a roster-editing procedure for
staff. You need authorization to repair the specific test record, database write access in the LVBT
Cloudflare account, a clean checkout matching the deployed schema, and an independently verified
[database backup](./back-up-membership-database.md). Keep provider writes and scheduled jobs
disabled.

Check the database name and ID against `apps/staff/wrangler.jsonc`. Do not select `lvbt-platform`.
Keep the backup and record-specific repair files in the approved private directory. They contain
member and authentication data and must never enter source control, public build artifacts, or task
descriptions.

There is no general hosted fixture-repair command. An implementation maintainer must prepare and
review a repair for the exact records and schema before an operator applies it. The preparation
steps below define that contract; they do not authorize improvising SQL against linked accounts.

## 1. Confirm the problem and the record

1. Sign in to the protected preview with the approved tester's existing Google account.
2. Open **Members**, find the synthetic test record, and open its profile. An invalid-link message
   after a successful sign-in can indicate an invalid person identifier. It does not prove the
   Google account or administrator permission is broken.
3. Inspect the selected record privately. Confirm its test marker, approved inbox, current
   membership, Google link, and administrator designation. Check for committee assignments, other
   linked providers, and duplicate people. Resolve unexpected real data or relationships before
   selecting a repair.
4. Compare the identifier with the ULID format required by member profiles. A ULID is a 26-character
   record identifier. The database can accept a text value that the portal refuses.

Do not remove the Google link, repeat administrator setup, rename the person's primary key, relax
profile validation, or edit immutable audit records to make the page load.

## 2. Prepare the repair against the verified backup

The implementation maintainer works on disposable copies of the restored backup, leaving the
original verified copy unchanged.

1. Create a clearly marked synthetic survivor with a new valid person identifier. Do not give it a
   second email address, invented consent, or a separate administrator grant.
2. Use the current application's audited
   [person-merge operation](../../packages/platform-storage/src/merges.ts) to merge the invalid test
   record into that survivor. Retain its snapshot guards, operation ordering, membership derivation,
   and audit creation. Capture the actual bound statements privately; do not write a second set of
   ad hoc relationship updates.
3. Prepare three private files: preparation, one invocation, and cleanup. Preparation creates a
   uniquely named temporary gate table and trigger. A trigger is database work performed by another
   statement. In this repair, one insert into the gate runs creation and the normal merge together.
   A final check must stop and undo the operation unless the merge completed and the surviving
   person remains an active administrator. This prevents a refused snapshot from leaving a second
   person behind.
4. Test that exact bundle against a fresh copy of the backup. Confirm profile loading, one active
   test person, the transferred Google link and consent evidence, retained administrator access,
   unchanged existing audit rows, and no broken database relationships.
5. Inject an error after the merge writes and prove that the entire invocation rolls back. On
   another fresh copy, change a guarded source field and prove refusal also rolls back every repair
   write. A successful normal run alone is insufficient.
6. Have another maintainer review the selected source and survivor, complete SQL, target, guards,
   rehearsal results, and cleanup. Freeze that reviewed bundle. Changing its identifiers, snapshot,
   or statements requires another rehearsal and review.

The temporary gate keeps the entire repair in one database statement. Do not assume a dashboard
editor applies a file of several statements as one operation that can be undone on failure. Cleanup
must name only the temporary objects created for this repair; it must not delete membership or audit
data.

## 3. Apply the reviewed bundle once

Use the approved database-write credential with the supported D1 command, or the signed-in LVBT
Cloudflare dashboard when that credential is unavailable. Do not reuse a credential belonging to a
different Cloudflare account or widen the deployment key's permissions.

For the dashboard path:

1. Open **Storage & databases → D1 → lvbt-platform-preview → Console**. Recheck its database ID.
2. Run each reviewed preparation statement separately. Read its result, then inspect `sqlite_master`
   to confirm only the intended gate and complete trigger exist. Compare the stored trigger with the
   reviewed file before invoking it. Preparation must not change member data.
3. If preparation reports **incomplete input**, stop. The dashboard console can reject a trigger
   containing `CASE … END` even when local SQLite accepts it. A maintainer can prepare an equivalent
   `iif` expression, but must rehearse and review the changed bundle first. Never remove a guard or
   final abort check just to satisfy the editor. A single-line console field also requires a
   separately verified single-line form of the SQL.
4. Execute the reviewed invocation exactly once. It inserts the fixed operation identifier into the
   gate. Do not rerun after an ambiguous response: inspect the operation, survivor, and source
   first. A query error can follow a provider write.
5. Verify the expected results from step 2 against the hosted database. Compare existing consent and
   audit evidence with the backup privately; do not print session or authentication values.
6. Remove the reviewed temporary trigger and gate after successful verification. If preparation or
   invocation failed, inspect actual state before cleanup or retry. Remove any harmless diagnostic
   probes too. Confirm the temporary objects are absent from `sqlite_master`.

If the expected merge is absent, a source guard changed, or evidence differs, keep the portal test
open and investigate. Do not restore the entire backup over newer hosted activity as a shortcut.

## 4. Verify the tester's actual sign-in and profile

Normal merges invalidate existing sessions. Sign in again with the same approved Google account; the
retained identity should resolve to the surviving person. The tester completes any passkey or inbox
confirmation themselves. Unexpected membership confirmation is a reason to inspect linkage, not to
create another fixture.

Open **Members**, find the test person, and open their profile. Confirm the profile, committees, and
linked accounts load, then return to Members and confirm the record appears once. Verify the
original administrator grant and the new merge are audited. Record a concise outcome in the task's
comment and completion checkboxes; keep the detailed evidence in the private operational record.

After administrator access is stable, finish the temporary setup-secret cleanup in
[first-administrator setup](./set-up-staff-preview.md#7-complete-first-administrator-setup). This
recovery proves the selected preview test membership works. It does not establish provider
acceptance, a complete real roster, or production readiness.
