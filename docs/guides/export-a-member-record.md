# Export a member record

This guide explains how a staff administrator downloads one person's record for a data request. Use
it when someone needs a readable copy of the personal information LVBT holds about them.

## Before you start

- Confirm the requester's identity through your established private contact with them.
- Sign in to the staff portal with your linked LVBT Workspace account. You must be a current member
  and a designated staff administrator. Committee leadership alone does not grant export permission.
- Choose a private location for the download and the approved private channel for returning it. The
  file contains personal information.

Members can also sign in to their own account, open **Your data**, and download their record without
administrator help.

## Download the record

1. Open **Members** in the staff portal and find the person. Check their name and email against the
   request before opening their profile.
2. Select **Download member record**. Your browser saves a file named
   `lvbt-member-data-YYYY-MM-DD.json`. JSON is a text format you can open in a text editor.
3. Read the summary and `details` at the start of the file. Confirm they identify the intended
   person. Review the sections the person asked about before sharing the download.
4. Return the file through the approved private channel. Remove your local working copy when the
   request is complete according to your organization's handling policy.

## What the file contains

The record includes the current profile, where each detail came from, consent agreements and
withdrawals, linked accounts, stored Discord profile observations, committee assignments, and
readable recorded activity. Recognized activity facts include donation amounts and currencies, event
names and dates, locations, invitation responses, volunteer shifts and durations, contact methods,
and role changes. It also includes newsletter status observations and source-event times that belong
to the person's currently linked newsletter account. The file explains the difference between a
person's choice time and the time LVBT observed a status.

Private staff notes, arbitrary activity payloads, staff identifiers, references to other people,
duplicate candidates, and archived merge records are omitted. Profile correction history identifies
which fields changed and when. Sign-in sessions, codes, credentials, encrypted inbox addresses, and
provider delivery receipts are excluded. This download does not change membership, consent, account
links, committee assignments, or provider access.

## If the download does not work

- **You are asked to sign in again:** the session expired, was revoked, or no longer matches the
  linked Workspace identity. Sign in again with your own account and reopen the person's profile.
- **Access is denied:** confirm that your membership and administrator designation are current. Ask
  an existing administrator to review the designation; do not grant yourself access as a workaround.
- **The old profile no longer opens:** a deletion or record combination may have changed which
  profile is current. Return to **Members** and locate the current record before trying again.
- **A section is empty or a value is `null`:** LVBT has no corresponding recorded value in the
  export snapshot. Newsletter observations are stored observations, not a fresh provider lookup.
- **The file names someone else:** do not send it. Delete the mistaken local download, return to
  **Members**, and verify the correct profile against the request.

The server checks current ownership or administrator access while collecting the record and again
before returning it. If access or account ownership changes during collection, start a new download
after resolving the change. Download responses are private and instruct browsers and intermediaries
not to cache them.

Per-person export receipts live in the existing append-only `staff_audits` table under action
`person.export`. Each records the authenticated requester ID, exported person ID and time, with
`details.requested_by` set to `member` for a self-download or the administrator's person ID for an
on-behalf download. Administrator receipts also identify permission `export.full`. Receipts contain
no contact details, export contents or session secrets. The final authorization check and receipt
insert are one guarded statement; a refused or revoked request creates no export receipt.

For staff access setup, see [staff portal operations](../reference/staff-portal-operations.md).
