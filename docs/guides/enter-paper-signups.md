# Enter paper signups

This guide explains how event volunteers record a paper signup sheet in the staff portal. Use it
after an event to record attendance and the mailing-list choices people made on the sheet.

Staff who can open a person's profile can see **Events** there: recorded attendance and responses to
event invitations (RSVPs), with event names and dates when available. Totals include the full
recorded history; the list shows up to 10 recent participation records, independently of other
activity. Missing names are labeled rather than inferred. An empty record does not prove that
someone has never attended. Corrected entries are excluded. Dates show when attendance happened or
when an RSVP was recorded; an RSVP date is not the event's start time. The profile does not provide
event rosters, check-in by scanning a code, or RSVP import.

## Before you start

- Use your own linked LVBT Workspace account and current membership. You need permission to record
  attendance. Ask an administrator if access is denied.
- Have the original sheet, its event or place, its date, and its signup wording available. Do not
  send a photo of the sheet through public chat or add contact details to task descriptions.
- Choose the intended environment. Use only clearly marked test people in the protected preview;
  record real signups only in the approved live portal.

An authorized Workspace volunteer can open `/paper/` and `/paper/sheet/` without general staff
console access. Their sign-in lands on paper signups and the header offers only their authorized
tools and sign-out. This does not grant member search, profiles, exports, welcome or administration.
The same Cloudflare Access sign-in gate, current membership, and verified LVBT Google sign-in are
required on each request; a revoked session or ended membership removes paper access too.

## Record attendance for someone already known

1. Open the person's profile and choose **Record attendance** under **Events**.
2. Enter the event's name and the date they attended. Future dates are not accepted.
3. Select **Record attendance**. The profile's Events section shows the saved entry.

This records attendance against that exact person, without re-entering their contact information or
changing membership or consent. You need both access to their profile and permission to record
attendance. Repeating the same person, event name and day does not add a second staff attendance
record. Use a consistent event name; distinct events on the same day need distinguishable names. The
entry records who saved it and keeps day precision rather than claiming an exact arrival time.

If a form expires, check Events before reloading and trying again. If saving fails, entered values
remain on the form; retry after the service recovers. Use paper signup entry below for new people or
when transcribing the mailing-list choices on a sheet.

## Print a blank sheet

1. Open **Paper signups** and select **Print blank signup sheet**.
2. Use your browser's Print command. Select US letter paper and check the preview: all 12 rows and
   the signup wording should fit on one page.
3. Write the event or place and date on the printed sheet. Each person marks **Yes** only if they
   want to join the mailing list and become an LVBT member. A phone number is optional.
4. Keep completed sheets private while they await entry, following LVBT's paper-record policy.

The current sheet's footer identifies its wording as `paper-v1`. The earlier `paper-signup-v1`
wording remains supported for existing sheets. Do not change or infer a person's choice because the
sheet is old.

## Record a completed sheet

1. Open **Paper signups**. Enter the event or place and the date exactly as written on the sheet.
2. If this was an LVBT public-calendar event, choose it under **Public calendar event (optional)**.
   Otherwise leave **Not on the public calendar** selected. Keep the written name and date even when
   you choose a calendar event.
3. Choose the wording printed on the sheet. **Check the signup wording** shows the current text. Ask
   an administrator to check unfamiliar wording before saving; do not choose the nearest match.
4. Enter each person's name, email, and optional phone number. Check **Mailing-list signup** only
   when their row marks **Yes**. Leaving it unchecked records attendance without making them a
   member.
5. Select **Add another person** when you need more rows. With JavaScript available, it adds one
   blank row and moves the cursor to its first field. Without JavaScript, it reloads the form with
   five more rows while preserving your entries. One sheet supports up to 12 people; blank rows are
   skipped.
6. Select **Save sheet** once. Check the result before entering another sheet. For example, **Saved
   5 entries. 3 new people · 2 existing people** means all five attendance entries were saved. The
   counts describe people created or matched, not how many chose membership.

A possible duplicate is saved as a new person for staff review rather than silently attaching a
signup to someone else's record. The result counts that person as new and shows how many possible
duplicates need checking. Administrators can open **Check possible duplicates**; other volunteers
should notify an administrator through the usual private channel.

## Resolve a problem

- **An entry is marked:** fix that row and save again. Nothing from an invalid sheet is saved.
- **The form expired or was already submitted:** your entries remain visible. Check whether the
  sheet was saved before trying again. Repeating the same submitted sheet does not add another copy.
- **The sheet may already have been recorded:** stop and ask an administrator to check it. Do not
  rename the event or change the date to get around the warning.
- **A mailing-list signup did not renew membership:** LVBT has a withdrawal on or after that date.
  Attendance is saved, but the old sheet cannot reverse the later choice. Ask the person to make a
  fresh choice through the normal signup flow if they want to rejoin.
- **A public event is missing:** leave the calendar selection blank and keep the written name/date.
  Calendar choices come from the public calendar when this portal release is built; they are not a
  live lookup on each form submission. A later release can refresh the list.
- **Saving failed:** keep the original sheet and your entries. Retry after the service recovers,
  checking the saved result before making another submission.

Do not discard the original sheet until entry and any review are complete and LVBT's retention
policy permits it. For follow-up, see [Welcome a new member](./welcome-a-new-member.md).
