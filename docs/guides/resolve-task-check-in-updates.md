# Resolve an uncertain task check-in update

Use the staff console to recover a volunteer's Discord update when its Notion result is unclear.
Checking the existing result avoids sending the same comment twice.

## Before you start

You need a current staff administrator account for the intended environment, access to the affected
Notion task, and a configured task-check-in service. A staff role does not grant Notion access. The
scheduled service needs its existing Notion connection to check comments. You can keep the source's
delivery settings paused during recovery; disabling the whole task-check-in service also stops
queued checks.

When the environment-wide task feature is disabled, a linked volunteer can still use **/checkins**
to pause or stop messages. The unavailable-service reply has no opt-in or task-update controls. Keep
the signed Discord interaction endpoint, public-key verification, and the existing
environment/guild/source bindings configured so those preferences remain reachable. Removing those
bindings disconnects the callback; the service does not guess a different environment or task
source. Sending and Notion updates remain disabled, and no provider credentials are needed to save
the volunteer's own pause or stop choice.

Keep provider credentials and volunteer response text out of support tickets and public logs.

## Review the update

1. In the staff console, open **Members**, expand **Member records**, and choose **Task check-ins**.
   Open **Troubleshooting**. Select the intended Notion source if more than one is listed. The
   settings form remains available through **Settings**.
2. Under **Updates needing attention**, identify the person and task. Check the current assignment
   and task state in Notion before making a decision.
3. Use **Retry safely** for a failed update only when that control is available. The service checks
   the current task, account, and preferences again before processing it. A changed task or
   withdrawn consent can still prevent the retry.

For example, an explicitly rejected progress comment may offer **Retry safely** after the connection
is repaired. A comment whose request timed out stays unconfirmed and offers **Check Notion again**.
Do not treat these outcomes as equivalent.

## Correct a person match

Open **Matches** in the task check-in navigation. Open **Review match** for the Notion account,
verify the assignment in Notion, and search for the correct LVBT person. Select their record and
choose **Change person match**, or expand **Remove this match** and choose **Remove match** to leave
the account unmatched. Displayed Notion names help you recognize the account; they never establish
identity.

Matches apply across task sources in the same Notion workspace. Changing or removing one pauses
check-ins for the affected people, including their merged records, and disables old card controls.
Each person must choose to receive check-ins again through Discord. Membership and staff access do
not change. Past responses remain with the person who submitted them; existing Discord messages and
Notion comments remain in those services.

If another administrator changed the match or settings, reload before continuing. A stale form
cannot replace a newer match. When a merged record has two Notion accounts, remove the incorrect
match before confirming the intended one; the service does not choose an account automatically.

## Check an uncertain comment

1. Choose **Check Notion again**. The page shows that a check is queued or in progress. This action
   records a durable request; it does not post another comment.
2. The scheduled service looks for a comment authored by the connected integration with the exact
   reference for the original response. A positive match confirms the stored result and removes it
   from the attention list. The existing private Discord card can then show the confirmed update.
3. If no matching comment is found, the update remains unconfirmed. Notion lists unresolved
   comments, so an absent result does not prove that the original write failed. Open the task in
   Notion and inspect its discussion directly.
4. Choose **Close without retrying** when you decide to stop recovery of that response. Closing
   leaves its result unconfirmed, cancels an outstanding check, and never repeats the write. It does
   not remove or modify any comment already in Notion.

Private card refreshes require active source delivery and the volunteer's current consent. Closing
an update while delivery is paused does not immediately edit their Discord message.

## When recovery cannot proceed

| What you see                           | What it means                                                                             | What to do                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The form expired or the record changed | Another action, a new task version, or an expired form made the displayed decision stale. | Reload the page and review the current record before choosing an action.                                             |
| A check stays queued                   | The scheduled service may be disabled or unable to process this environment.              | Ask the service owner to check the scheduled service and its configured source. Keep delivery paused during repair.  |
| Notion could not be checked            | The provider request failed or an interrupted check exhausted its bounded attempts.       | Have the service owner verify the Notion connection and comment-read permission, then choose **Check Notion again**. |
| No safe retry is offered               | The update may be uncertain, completed, or outside the person's current authority.        | Inspect Notion and current account preferences. Use the uncertain-comment procedure when offered.                    |
| Your administrator access was removed  | Current authority no longer permits recovery.                                             | Have another current administrator review the request; do not share accounts.                                        |

Checks use at most three attempts; a credential or permission failure can stop sooner. An
administrator can request a fresh check after repairing the connection. Resolved comments can remain
absent from Notion's listing, so repeated negative checks never authorize posting the original
response again.

For database recovery rather than an individual update, use the
[member database backup procedure](./member-database-backups.md).

## Expired task history

Set **Private task history retention in days** in **Settings**. Private response text expires from
the time it was submitted. Completed or removed task details expire from the time they became
inactive; repeated scans do not restart that clock. Active task details also expire when they have
not been observed within the configured period. Current source reads can restore active task
details, but cannot restore expired responses. Saving an incomplete paused draft keeps the last
valid retention period. Cleanup continues while sending is paused or the provider is unavailable.

An expired response cannot be retried, even after increasing the retention period. Check Notion
before asking the volunteer to submit a new update. An uncertain comment stays unconfirmed after its
local text expires; **Check Notion again** can still confirm a matching existing comment without
reposting it. Cleanup leaves a live attempt untouched; an interrupted attempt remains unconfirmed.

Current notification choices and minimal receipts that prevent repeated sends remain. Expiring local
history does not delete a comment in Notion or a message in Discord; those services control their
copies separately. The person’s activity history records when they responded or changed their own
preferences, without task details, response text, provider references, or the specific response or
preference chosen. Those dates follow the ordinary LVBT person-record retention policy so recent
volunteering is recognized after Discord is unlinked. Automated notifications and staff source
changes do not count as volunteer activity. Profile erasure removes these activity records through
the LVBT person-record privacy workflow.

## Notification limits

In **Settings**, confirm the maximum notifications per person in a rolling 24-hour window and the
minimum spacing in minutes. Reminders and daily summaries from that source share these limits.
Unconfirmed sends count as attempts, so a timeout cannot accidentally bypass the cap. Waiting for a
limit does not consume provider retry attempts. The next scheduled check reevaluates the task and
its current permissions before sending; an outdated reminder or summary can expire without being
delivered. Existing settings without confirmed limits cannot enable delivery.

## Support notifications

In **Settings**, choose whether confirmed help requests are routed to support and set the number of
overdue hours before a task needs organizer attention. Leave the overdue field empty to turn off
that trigger. Choose the selected support people or the task's current Notion project leads. Confirm
that this task source and help notes may be shared with the configured support audience before
enabling those notifications. Each recipient needs their own active check-in consent, verified
Discord account, and place in the approved trial group. Project leads also need a confirmed person
mapping.

Review **Help requests that need attention** in **Troubleshooting** when a route or message cannot
be completed. Open the task in Notion to confirm its current lead, and use **Review account match**
when a lead needs a matching LVBT record. Correct the trial group, connection, or preferences as
appropriate; the service checks unresolved routing again. It never falls back to a public channel or
guesses a Discord handle.

Use **Retry safely** only after reviewing a known failed attempt. An uncertain message create has no
retry button because Discord may already have accepted it. Inspect the recipient's Discord
conversation before choosing **Close without retrying**. Closing acknowledges the issue without
claiming a confirmed delivery. Quiet hours and shared notification limits defer support messages; an
assignee's snooze also defers overdue escalations, while a deliberate help request remains eligible
for support.

If Notion cannot be checked while finding project leads, the request stays in staff review. A Notion
wait appears in **Troubleshooting**; saved updates remain queued until that wait ends. The service
then checks the current task and lead again, without asking the volunteer to repeat their response.
Waiting applies across the task workers, including after a scheduled invocation restarts. Closing a
review entry does not shorten the provider's wait.

When routing cannot finish within a bounded check, its review entry remains visible for another
check. If it keeps waiting, review the linked projects and support configuration. The service never
uses an incomplete lead list as permission to send task details.

## Task sync status

Open **Task check-ins**, then **Troubleshooting**, to check whether the first complete sync has
finished and when the last complete sync succeeded. An access notice means the Notion connection or
source permissions need attention; check those before changing people’s mappings. Other sync
failures point to source fields or connection problems. The staff page shows a general explanation
rather than raw provider output. Partial or failed scans preserve unseen tasks until the entire sync
completes successfully.

## Participant choices

Open **People** from **Task check-ins** to see whether someone enabled, paused, or stopped messages,
or needs to approve changed settings. The view also identifies an account that needs confirmation,
an unmatched Notion account, or a person outside the current trial group. These are read-only
choices: the participant uses **/checkins** to enable or change their own preference. A ready source
choice does not prove that provider access or private messages are available.

## Tasks held for review

In **Troubleshooting**, review **Task details to fix** for invalid or missing deadlines, an
unconfirmed date range, missing assignments, unsupported status, or other source details that
prevent check-ins. Follow the task link to correct it in Notion, or confirm the intended range
boundary in source settings. A later successful sync re-evaluates the task. Ordinary completed and
archived tasks do not appear here.

## Summaries and card updates

**Summaries and card updates needing attention** separates failed daily summaries from failed edits
to existing task cards. **Retry safely** rechecks the current account, choices, source, and
schedule. Retrying a card edit updates its existing private message; it does not repeat the
volunteer’s Notion response.

An uncertain summary cannot be resent automatically. Check Discord, then use **Close without
retrying** when the outcome cannot be established. Closing preserves an unconfirmed result and
prevents another send of that summary; it does not claim that delivery succeeded. Resolve account or
source-readiness problems before retrying a known failure.
