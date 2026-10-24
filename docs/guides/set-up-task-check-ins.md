# Set up volunteer task check-ins

For shared project channels, forum posts, and task-thread updates, use
[Discord project conversations](./set-up-discord-project-work.md). Shared links and private reminder
consent have separate controls.

Use this procedure to prepare Notion tasks, private Discord check-ins, and the staff controls for an
approved LVBT trial. Keep sending disabled until the environment, audience, and trial window have
been reviewed. Routine source settings and recovery use **Task check-ins** in the staff console.

## Before you start

Identify the service owner, participating committee, and the people who will receive help requests.
Choose a small trial group containing a member and a Notion guest, both with verified Discord
accounts in the intended server. Agree on the schedule, permitted actions, content audience,
retention period, and concrete success criteria. Support recipients need their own opt-in and place
in the trial group.

You need a staff administrator account, an authorized release operator, Notion source access, and
permission to manage the intended Discord application. Use the existing
[staff preview setup](./set-up-staff-preview.md) and
[saved release procedure](../reference/staff-portal-operations.md#release-order-and-rollback). Back
up the intended database and review migration `0054_notion_task_checkins.sql` through the
[database backup procedure](./back-up-membership-database.md) before applying a release.

## Prepare the provider connections

1. Create an LVBT-owned Notion connection for the selected task and project sources. Share those
   resources with the connection and review inherited access to their children. Enable **Read
   content**; add **Update content** when marking tasks complete is permitted. Progress, help, and
   extension comments need **Insert comments**, and uncertain-comment recovery needs **Read
   comments**. Enable **Read user information without email addresses** so comments can attribute
   responses to their Notion assignee. Email access is unnecessary. These are separate
   [Notion capabilities](https://developers.notion.com/reference/capabilities).
2. Record the task **data source ID**, workspace ID, and the property names or property IDs for the
   task title, description, assignee, deadline, status, and project relation. This implementation
   uses Notion API version `2025-09-03`. The data source ID is not an individual task page ID.
   Project-lead routing also needs the project data source ID and its lead property. Confirm that an
   assigned guest appears on an accessible task; do not depend on a workspace-wide user list to
   discover guests.
3. Prepare the Discord application owned by the LVBT team. Install its bot in the intended server
   with the `bot` and `applications.commands`
   [installation scopes](https://docs.discord.com/developers/topics/oauth2#oauth2-scopes). This task
   flow does not need guild administration privileges. Verify the bot can check the participants'
   server membership and deliver a private message to them; blocked DMs remain a recoverable failure
   and never redirect task content to a public channel.
4. Configure the deployed website's `/platform/discord/interactions` route as the application's
   [Interactions Endpoint URL](https://docs.discord.com/developers/interactions/receiving-and-responding).
   Discord must reach the signature-verifying route. Keep staff-console Access protection in place.
   Confirm the provider accepts its PING verification and that an invalid signature is rejected.
5. Use a separately approved application for an isolated preview trial. An application has one
   [interaction endpoint setting](https://docs.discord.com/developers/resources/application#application-object),
   so redirecting the production application to preview would change production interaction routing.
   The Discord application settings are shared with account linking and role automation; include
   those features in any review of changed application IDs, public keys, or bot tokens.

## Prepare the environment while sending stays disabled

Manual task updates have a separate switch from automated reminders. Keep
`LVBT_TASK_CHECKINS_ENABLED=false` and set `LVBT_TASK_UPDATES_ENABLED=true` on the website and jobs
workers to allow status changes, notes, and edits of existing cards. The source and participant
consent must still be active. Reminder scheduling, queued deliveries, digests, and escalations
remain disabled. Leave both switches off to stop all updates.

Configure the reviewed website and jobs release together. Both must use the same intended
`PLATFORM_DB`, deployment environment, task source, application, and guild. Staff must use that
environment's database too. Preview and production use separate databases, guilds, and task sources.

| Setting                                 | Where                  | Required choice                                                                                     |
| --------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| `LVBT_TASK_CHECKINS_ENABLED`            | Website and jobs       | `false` during preparation; enable only for the approved trial.                                     |
| `LVBT_TASK_UPDATES_ENABLED`             | Website and jobs       | `true` to allow manual status changes and notes on existing cards while reminders stay disabled.    |
| `LVBT_DEPLOYMENT_ENV`                   | Website and jobs       | `preview` or `production`, matching the release.                                                    |
| `LVBT_NOTION_TASK_SOURCE_ID`            | Website and jobs       | The intended task data source UUID.                                                                 |
| `LVBT_NOTION_TASK_PRODUCTION_SOURCE_ID` | Website and jobs       | The production source UUID used as the isolation reference; preview must select a different source. |
| `LVBT_DISCORD_APPLICATION_ID`           | Website and jobs       | The application installed in the intended server.                                                   |
| `LVBT_DISCORD_GUILD_ID`                 | Website and jobs       | The intended server; it must differ from the production reference in preview.                       |
| `LVBT_DISCORD_PRODUCTION_GUILD_ID`      | Website and jobs       | The production server reference.                                                                    |
| `LVBT_DISCORD_PUBLIC_KEY`               | Website                | The intended application's public verification key.                                                 |
| `LVBT_NOTION_TASK_API_KEY`              | Jobs secret store only | The approved Notion connection token.                                                               |
| `LVBT_DISCORD_BOT_TOKEN`                | Jobs secret store only | The intended application's bot token.                                                               |

Put credentials in the approved environment's secret store using the existing
[secret-management procedure](../reference/platform-secrets.md). Do not paste tokens into source
settings, task records, logs, or shell command text. The website saves signed user intent; the jobs
service performs provider effects. Receiving a Discord interaction does not require provider secrets
on the website.

A disabled website preview requires its existing sign-in and email credentials, but does not require
new credentials for inactive integrations. Its upload retains all already stored secrets. Production
still declares its full credential requirements. Before enabling a trial, separately verify every
connection needed for the approved actions; retaining a binding does not prove that its provider
access works.

The checked-in preview jobs configuration has no cron schedule. Prepare an approved, bounded
schedule or scheduled-run procedure for the trial and its shutdown. A feature flag alone does not
start jobs. Keep the production task feature disabled during preview testing and preserve unrelated
membership, newsletter, and role processing.

## Configure a paused source

1. Open **Members**, expand **Member records**, and choose **Task check-ins**. The **Settings** page
   opens with the saved configuration. In **Connection and field mapping**, enter the reviewed
   source and workspace IDs, field mapping, and server. Confirm the status property has a **Done**
   option before permitting completion; cancellation follows archived or trashed source pages.
2. Review the timezone and date-range behavior. A date-only deadline lasts through the local day.
   Choose pre-deadline reminders, overdue reminders, unanswered follow-ups, daily-summary hour,
   quiet hours, snooze duration, and the shared notification cap and spacing.
3. Select the service owner, trial participants, support recipients, and permitted actions. Confirm
   task content is suitable for its assignees. Separately approve sharing task and help content with
   support recipients before enabling escalation. Enter the retention period and trial success
   criteria. Leave **Allow automatic reminders for this task list** unchecked and save the paused
   draft.
4. Open **Troubleshooting**. Under **Match people to their LVBT accounts**, review each Notion
   assignment and explicitly select its existing LVBT person record. Names and handles help
   recognition; they do not establish identity. Use the established
   [Discord account-linking flow](../reference/platform-secrets.md#register-the-link-command) for
   verified account ownership. A Notion guest does not need membership or staff access. Do not
   create a duplicate record or grant membership to make a task deliverable.
5. Open **Matches** to inspect already linked accounts. Resolve conflicts before proceeding. Follow
   [person-match correction](./resolve-task-check-in-updates.md#correct-a-person-match) if a match
   is wrong; a correction pauses affected choices and requires renewed opt-in.

Source settings being ready does not prove provider connectivity, a successful scan, or delivery.
Before activation, run `pnpm check` on the reviewed source and the relevant compiled cross-worker
tests. Confirm the saved release, migration, bindings, and callback separately.

## Run the approved trial

1. Confirm the exact environment, source, cohort, staffed trial window, schedule, and shutdown plan.
   Review the member and guest's test tasks and the expected support recipient. Obtain the normal
   approval for deployment, scheduling, and live provider writes before activation. Have the release
   operator confirm that the selected artifact and activation procedure support the task flags;
   resolve a refused preflight before proceeding.
2. Activate only the reviewed environment's feature flags and source delivery setting. The scheduled
   jobs register the guild's **/checkins** command without replacing unrelated commands. Repair
   registration or callback failures before inviting participants to continue. Account linking uses
   its existing **/link** setup separately.
3. Each participant runs **/checkins** in the intended server, reviews the actual schedule and
   audience, and chooses **Enable check-ins**. Staff cannot opt in for them. Confirm no task content
   reaches a participant before their own opt-in.
4. Observe actual private reminder cards in Discord on desktop and mobile. Exercise progress, a help
   request, a deadline-extension request, completion, and snooze. Confirm attributed comments in
   Notion, the **Done** status for completion, and that extension requests leave the deadline
   unchanged. Acknowledging a queued response is not confirmation that Notion saved it.
5. Confirm private support routing to an independently opted-in recipient, the configured summary,
   quiet hours, shared limits, and pause/stop behavior. Exercise one approved DM failure, stale
   assignment/card, and uncertain comment outcome. Use
   [staff recovery](./resolve-task-check-in-updates.md) to verify visible outcomes without duplicate
   writes, guessed identities, or public fallback.
6. Record the observed member and guest outcomes, successful updates, duplicates, failures, and
   participant feedback in the private trial record. Compare them with the agreed success criteria
   and decide to expand, revise, or stop. Code checks and simulated providers do not replace these
   observations. End the bounded preview schedule and sending activation when the trial window ends.

## Pause and recover

Uncheck **Allow automatic reminders for this task list** to pause a source. Retaining the same terms
permits a later resume without replaying stale reminders; changing policy terms requires renewed
opt-in. Changing an identity match also requires renewed opt-in. For an environment-wide stop, pause
the active source first, then disable the jobs task flag and the website task flag through the
approved release process.

After an environment-wide stop, keep the signed callback and environment/guild/source bindings
available so volunteers can still pause or stop through **/checkins**. An unavailable policy or
removed trial eligibility also leaves those private stop controls available to linked people. No
enable or task update action is available through that reply.

Use the staff attention queues and restricted jobs logs to distinguish a provider failure, a saved
wait, an unconfirmed effect, and a configuration problem. Do not reset held effects or repost an
uncertain comment based on an absent result. Restore databases only through the existing verified
backup/recovery process; restoring data is not permission to replay provider effects. Escalate
unexpected routing or disclosure to the service owner and keep delivery paused during review.

## Preserve the trial during a portal release

The production website and jobs configurations retain manual updates on existing cards while
scheduled reminders and shared Discord work remain disabled. Preview remains disabled and
unscheduled. Deploying the Staff Portal must retain the task administration pages, existing source
policies, participant choices, mappings, operations, and card references.

Before publication, compare the active website and jobs task switches and Notion source IDs with the
selected release configuration. Resolve any difference before uploading. Keep the deployed Notion
and Discord secrets in place. A portal authentication release does not authorize changing the trial
audience, enabling reminders, changing schedules, or sending test messages to volunteers. After
publication, verify both Workers retain the reviewed task configuration and that administrators can
still open the task check-in pages. Run the compiled manual-update acceptance test to verify notes,
status updates, and card refresh with reminders disabled.

Keep applied migration filenames unchanged. The release can contain distinct migration names with
the same numeric prefix when parallel releases have already deployed them. Packaging retains every
file and still rejects missing sequence numbers; D1 tracks the full filename. Apply only pending
migrations through the saved release workflow and retain existing task data.
