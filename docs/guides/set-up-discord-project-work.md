# Set up Discord project conversations

Use the existing LVBT bot to connect Notion projects and tasks to Discord. A project home supplies
the destination; a task conversation supplies the target for automatic reply updates. Private task
check-ins remain a separate choice.

## Prepare the release

1. Review the [task integration setup](./set-up-task-check-ins.md) for the existing Notion
   connection, verified person mappings, environment isolation, and credential storage. Reuse those
   connections. Provider tokens remain on jobs; the website receives only Discord's signed
   interactions.
2. Back up the intended database using the
   [database backup procedure](./back-up-membership-database.md). Apply migration
   `0055_discord_work_links.sql` before installing code that uses shared links. Preserve existing
   source settings and private check-in preferences.
3. Build the website and jobs together. The website's `DISCORD_WORK` service binding must target the
   same environment's existing jobs Worker and its `WorkPreview` export. The cf configuration calls
   this binding field `exportName`; the Wrangler configuration calls it `entrypoint`. Generated
   binding types and the compiled release must agree.
4. Keep `LVBT_DISCORD_WORK_ENABLED=false` on website and jobs during preparation. Keep
   `LVBT_TASK_CHECKINS_ENABLED` at its independently approved value. A source's paused DM delivery
   setting does not disable shared work, and a shared project link does not enable DMs.
5. Run `pnpm check` and the jobs build. Review the resulting native card payloads and the selected
   release using the
   [release procedure](../reference/staff-portal-operations.md#release-order-and-rollback). Local
   fixtures establish local behavior; they do not establish live Discord or Notion delivery.

Do not enable sending or publish provider resources without an approved environment and trial. The
checked-in configurations keep shared work disabled. Preview also requires the separately approved
schedule described in task integration setup; it has no checked-in cron.

## Check provider access

The existing Notion connection needs access to the configured task and project data sources. It
needs read access for source checks, comment insertion and reading for updates and recovery, content
updates for status changes, and content insertion for the managed conversation footer. Confirm the
configured project lead and task property names. A Notion guest can be mapped through an assigned
task without being made an LVBT member or staff administrator.

The bot needs View Channel and Read Message History in the approved destination. Publishing needs
Send Messages, Create Public Threads for a text-channel thread, and Send Messages in Threads where
applicable. Forum creation additionally needs Manage Channels in the selected category and a server
that supports forums. Adopt an existing destination when creation is unavailable; the bot never
broadens permissions or chooses a more public fallback. Check mandatory forum tags and whether the
bot can apply them.

Automatic reply saving needs the Message Content capability enabled for the existing application.
Enable or request it through the application's normal developer settings when authorized. HTTP
interaction callbacks alone do not deliver ordinary replies. Selected message updates and Add update
provide an alternative when automatic content access is unavailable.

Approve the Discord audience for each project. The integration cannot reproduce individual Notion
page permissions. Roles, channel overwrites, and the destination type are checked against the
approved link; access or audience changes stop affected work for review.

## Connect a project

After an authorized installation and activation, jobs register `/work` and **Save to Notion** by
name and command type, preserving `/link`, `/checkins`, and other commands. An already registered
command can provide private inspection while sending is disabled; confirmation still cannot queue
outgoing effects until the feature is enabled on the website.

1. An LVBT administrator uses `/work link` with the Notion project URL. Use the current text channel
   or thread, select a forum with the native destination picker, or select an approved category to
   create a project forum.
2. Review the project, destination, audience, and any required forum tag in the private preview.
   Confirm only the intended destination. Selecting a category requests a new forum; selecting an
   existing forum adopts it.
3. Use `/work show` to inspect the link. The project summary offers **View tasks**. A forum gets an
   overview post; the Notion project links back to that exact conversation.
4. A mapped project lead or administrator selects a task and starts its discussion. They can also
   use `/work link` with a task URL inside an existing task thread. Tasks related to several
   projects need an explicit project placement; use the chosen project's task picker.

A forum post is a thread. Existing project threads cannot contain additional threads; their task
cards use explicit selected updates instead of copying all project discussion to several tasks.
Linking a project does not publish its entire backlog.

## Update work

An active task card offers its status dropdown and **Add update**. Each action checks the current
person and assignment or project authority. Notion owns status and other task fields. Done cards are
read-only; reopening the task in Notion makes the existing card actionable again.

In an explicitly linked automatic task thread, new eligible human text replies become attributed
Notion comments with source links. Earlier conversation, bot replies, and general project chat are
not copied automatically. Saved updates are point-in-time records: edits, deletions, and attached
files are not mirrored. The bot does not infer status or deadlines from conversation.

To preserve a decision from broader discussion, use the message context action **Save to Notion**.
Choose its project or task and review the attribution and text before saving. Repeated saving of the
same source message to the same task deduplicates with automatic saving.

## Resolve a paused update

Use `/work show` in the affected location. Check source access, identity mappings, destination
permissions, Message Content access, and current assignments. Restoring a connection does not grant
someone new authority. Locked or archived threads are never automatically reopened.

An uncertain provider write is held to avoid a duplicate. Positive bot-authored comment references
can confirm that Notion received an update. Missing results alone are not proof of failure. Keep
held work for review; do not edit its state to retry blindly or delete deduplication records.
Likewise, retain any created forum, thread, or card until its durable record has been reconciled.

Use `/work unlink` to stop the current link. Existing discussion and Notion comments remain.
Unlinking invalidates controls and queued effects; it cannot cancel a provider request already in
flight. For a location containing several work references, identify the intended Notion target
before repairing or replacing its link. A relink starts a new activation boundary and does not
silently backfill conversation.

Disable `LVBT_DISCORD_WORK_ENABLED` on both website and jobs to stop all shared effects during
recovery. Preserve database records, credentials, and unrelated integration settings when rolling
back. Retained source text follows the configured source retention policy; provider copies follow
Discord and Notion policy independently.
