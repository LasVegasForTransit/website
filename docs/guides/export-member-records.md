# Export all member records

Use this guide when LVBT needs its records in a spreadsheet or is moving to another
contact-management system. This download contains everyone's recorded contact details and
permissions. For a request from one person, use
[Export a member record](./export-a-member-record.md) instead.

## Before you start

Sign in with your linked LVBT Workspace account. You must be a current member and a designated staff
administrator. Committee leadership alone does not allow a full export. Choose a private location
that only authorized staff can open.

## Download and check the files

1. Open **Members**, expand **Member records**, and select **Download member records**.
2. Select **Download records**. Save `lvbt-people-export-YYYY-MM-DD.zip`; the date is the Las Vegas
   date when you requested the file.
3. Extract the ZIP. It contains `people.csv`, `consent_records.csv`, `identities.csv`,
   `engagement_events.csv`, `export.json` and `README.txt`.
4. Open `README.txt` first. It explains every CSV column and gives worked examples for Google Sheets
   and a contact-management system. Match related rows using `id` and `person_id`, not row order.
5. Check that the download describes the intended records before importing or sharing it. Deleted
   people and their related records are excluded. Each successful download records who requested it
   and when.

## Import into Google Sheets

In a new private Google Sheet, choose **File → Import → Upload** and select `people.csv`. Import
into a new sheet with comma as the separator. Turn off automatic conversion of text to numbers,
dates and formulas. Keep identifiers, ZIP codes and census blocks as text so leading zeros and long
identifiers survive.

Check the headings and a few known records before importing the remaining files. Confirm names with
accents remain readable. If a heading or value looks misplaced, start a fresh import with comma as
the separator; do not repair the source CSV by deleting quotes or commas.

## Move to another contact-management system

Map `people.id` to the destination's external contact identifier, then map the name, email, phone
and ZIP fields. Keep membership status and membership-start date separate from newsletter
permission. A contact existing in the new system does not give permission to email them.

Match `consent_records.person_id` to the same contact identifier. Preserve the original permission
time, scope, method, source, wording version and withdrawal time. A withdrawn permission stays
withdrawn unless there is separate evidence of a later confirmed choice. Hold missing or conflicting
evidence for review; do not replace its original time with the import time.

Preserve `withdrawn_time_basis` too. With `choice`, the actual withdrawal time is known. With
`observed`, `withdrawn_at` is when LVBT learned the inactive status, and the person's actual choice
time is unknown. A conflict between that observation and a recent signup needs staff review; the
observation alone must not cancel a later confirmed choice or subscribe the person again.

`export.json` preserves original values, including the distinction between empty text and no
recorded value. Format 2 groups each person's related records inside their entry in `people`. Older
format 1 downloads used separate top-level arrays. Anyone writing an import script must read
`formatVersion` before choosing the appropriate structure. The CSV files continue to provide one
table per file, including `member_since` for the current unbroken newsletter subscription.

## Finish or recover

- Remove temporary uploaded sheets and local working copies when your verification or migration is
  complete, according to LVBT's handling policy. Keep approved retained copies private.
- If sign-in expires or access is denied, sign in with your own account and have an administrator
  review your current designation. Do not grant yourself access to complete an export.
- If the download stops or the page asks you to reload, reload the export page and request a fresh
  download. Reusing the old form is refused; it cannot issue a second copy.
- If a migration tool expects format 1 JSON, adapt it to format 2 or use the CSV files after
  checking their headings. Do not silently treat a missing top-level array as an empty dataset.

For configuration and recovery, see
[staff portal operations](../reference/staff-portal-operations.md).
