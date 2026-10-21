# Retire Notion membership intake

Maintainers and the president use this guide to move new-member follow-up to the staff Welcome queue
while preserving old Notion records. Use it only when completing that transition; it is not part of
connecting a new form or fixing an ordinary submission.

Before starting, select the reviewed website release and its membership database. You need release
publication authorization, staff administrator access, an approved form test, and access to the old
Notion intake database. Preserve the original form responses and existing historical records.

Keep the Google Form's existing script, URL, secret and trigger. The reviewed website release must
save signups in the membership database without creating Notion pages. The
[intake reference](../reference/membership-intake.md#endpoint-contract-apimembership-intake)
describes the unchanged request format and success response.

Complete the production transition in this order:

1. Select and promote a reviewed website release containing the intake handler that saves membership
   without writing to Notion using the [website release procedure](./test-the-workers-candidate.md).
   Confirm the staff Welcome queue uses the intended database. Keep the form's trigger and original
   source responses; do not delete the old Notion database.
2. Submit an approved original Google Form response. Confirm its Apps Script execution succeeds,
   then find the member profile and verify the original consent time and Google Form attribution. An
   affirmative newsletter answer creates membership and queued delivery; a blank or negative answer
   must not manufacture consent or a welcome-queue entry.
3. Open **Welcome** as a staff administrator and confirm the eligible new member appears once. Claim
   the entry and verify contact details against the approved response. Release it if the test does
   not include a real personal welcome. Check newsletter delivery separately.
4. Independently inspect the old Notion intake and confirm this response created no page. Replay the
   same original response and verify it creates no duplicate join event or Notion page. Preserve its
   original response ID, answers and submission time. Also verify approved website-join and
   newsletter-box fixtures create their member records and welcome email without creating Notion
   pages. Save concise verification in the private launch record; local tests do not establish this
   hosted result.
5. Only after that verification, the president adds a note at the top of the existing Notion intake
   database with the actual cutover date and the Welcome queue link. The note must say that the
   database is retired and new-member follow-up takes place in the Welcome queue.
6. The president makes the old database read-only through its sharing controls and verifies that
   staff can still read historical entries. Remove the old intake writer's ability to add pages to
   that database. Preserve the shared Notion connection needed for press and transit news; do not
   revoke its token as a substitute for retiring membership intake.

The historical source ID may still be needed for an explicitly authorized roster export. It is not
an intake runtime requirement. Historical provisioning and backfill scripts must not be run as part
of normal signup or recovery because they create Notion pages.

## Rollback of the transition

If intake fails, keep the original responses and inspect the member record before retrying. The
website may have saved the record before it failed to save the response used for duplicate
detection. Repair storage or restore a reviewed website release that does not write membership to
Notion through the saved-release recovery procedure, then replay the same response. Do not alter
consent timestamps, remove accepted member records or disable the form's trigger to hide an error.

A release predating this change creates Notion pages and requires its former Notion configuration.
Do not activate it against a retired, read-only intake database as an ordinary rollback. If the
organization deliberately resumes that older process, coordinate the database's write permissions,
staff instructions and retirement note before activating that release, then verify both membership
intake and follow-up again. Keep all existing member records and Notion history.
