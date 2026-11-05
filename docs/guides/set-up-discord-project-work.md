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
   [database backup procedure](./back-up-membership-database.md). Review the pending migrations in
   the selected release, including `0055_discord_work_links.sql`, `0057_discord_work_routes.sql`,
   `0058_discord_work_requests.sql`, `0059_discord_work_route_scans.sql`,
   `0060_discord_work_location_indexes.sql`, `0061_discord_work_canonical_identity.sql`,
   `0062_discord_work_comment_identity.sql`, `0063_discord_work_canonical_reservation.sql`,
   `0064_discord_work_tag_serialization.sql`, and `0065_discord_work_existing_events.sql`. Apply all
   pending prerequisites and these migrations separately using the commands in the
   [staff production release procedure](../reference/staff-release-operations.md#publish-an-approved-staff-production-release)
   before activating code that uses shared links or routes. Staff release does not apply migrations.
   D1 tracks full filenames, including distinct migrations with the same numeric prefix. Preserve
   existing source settings and private check-in preferences. Run the appropriate read-only
   [staff preflight](../reference/staff-portal-operations.md#read-only-configuration-check) and
   confirm all required migration names are present before enabling the integration.
3. Build the website and jobs together. The website's `DISCORD_WORK` service binding must target the
   same environment's existing jobs Worker and its `WorkPreview` export. The cf configuration calls
   this binding field `exportName`; the Wrangler configuration calls it `entrypoint`. Generated
   binding types and the compiled release must agree.
4. Keep `LVBT_DISCORD_WORK_ENABLED=false` on the active website and jobs during preparation. Keep
   `LVBT_TASK_CHECKINS_ENABLED` at its independently approved value. A source's paused DM delivery
   setting does not disable shared work, and a shared project link does not enable DMs.
5. Run `pnpm check` and the jobs build. Review the resulting native card payloads and the selected
   release using the
   [release procedure](../reference/staff-portal-operations.md#release-order-and-rollback). Local
   fixtures establish local behavior; they do not establish live Discord or Notion delivery.

Do not enable sending or publish provider resources without an approved environment and trial. The
reviewed production launch configuration enables shared work on website and jobs; preview keeps it
disabled. Preview also requires the separately approved schedule described in task integration
setup; it has no checked-in cron.

## Activate shared work in production

Before selecting a production release, complete the database backup and migration checks above,
verify Notion and Discord access for the intended trial, and review the destination audience. Keep
the current production Workers disabled until the release is approved. The selected website and jobs
artifacts must both set `LVBT_DISCORD_WORK_ENABLED=true`; leave task reminders and unrelated
provider settings at their independently approved values.

Before activating jobs, inventory existing shared-work routes, links, and outstanding operations in
the target database. For production, use the approved read-only D1 access and run:

```sh
pnpm -C apps/staff exec wrangler d1 execute lvbt-platform --remote --command "SELECT 'routes' AS item, state, count(*) AS total FROM discord_work_routes GROUP BY state UNION ALL SELECT 'project homes', state, count(*) FROM discord_project_homes GROUP BY state UNION ALL SELECT 'conversations', state, count(*) FROM discord_work_conversations GROUP BY state UNION ALL SELECT 'operations', state, count(*) FROM discord_work_operations GROUP BY state"
```

No rows means all four tables are empty. Otherwise, inspect the affected records privately and
reconcile uncertain operations; pause any route that must not run during the trial using
`/work routes` while the integration is available. If the integration is disabled and existing work
cannot be reviewed or paused safely, stop and arrange recovery before activation. The existing jobs
schedule can resume active routes and queued operations as soon as the new jobs version is active,
including before the website is promoted. Resume a paused route only after reviewing its destination
and audience.

Publish jobs through the [staff release procedure](../reference/staff-release-operations.md), then
promote the matching reviewed website release through the
[website release procedure](../reference/deployment-pipeline.md). Confirm the deployed jobs and
website versions use the reviewed settings and the website's `DISCORD_WORK` binding reaches those
jobs. Check that the existing bot registers `/work`, then set up and activate only the reviewed
routes. Verify the Notion footer, Discord return link, and organizer and volunteer access using the
approved trial records. A deployed version or registered command alone does not establish that
provider access or the volunteer experience works.

If the trial must stop, disable shared work on both applications through reviewed releases and
confirm the active versions. Keep existing mappings and provider content for recovery. Follow the
release procedures to reconcile any uncertain activation before retrying.

## Resolve conflicting link identities

Migrations `0061_discord_work_canonical_identity.sql`, `0062_discord_work_comment_identity.sql`, and
`0063_discord_work_canonical_reservation.sql` reject duplicate identities that differ only in the
capitalization or hyphenation of a Notion ID. Migration `0064_discord_work_tag_serialization.sql`
rejects concurrent tag updates for the same conversation. Before applying them to a database that
already has shared work, use the approved read-only D1 query method in the
[backup procedure](./back-up-membership-database.md#1-confirm-the-source-and-save-its-inventory) to
run these checks against the selected database. Keep the results private; the IDs can identify
internal projects.

```sql
SELECT scope_key, lower(replace(source_id, '-', '')) AS source, lower(replace(project_id, '-', '')) AS page, count(*) AS n
FROM discord_project_homes WHERE state <> 'unlinked' GROUP BY 1, 2, 3 HAVING count(*) > 1;
SELECT scope_key, json_extract(data_json, '$.subject.kind') AS kind, lower(replace(json_extract(data_json, '$.subject.sourceId'), '-', '')) AS source, lower(replace(json_extract(data_json, '$.subject.pageId'), '-', '')) AS page, count(*) AS n
FROM discord_work_conversations WHERE state <> 'unlinked' GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;
SELECT scope_key, lower(replace(source_id, '-', '')) AS source, count(*) AS n
FROM discord_work_routes WHERE state = 'active' GROUP BY 1, 2 HAVING count(*) > 1;
SELECT scope_key, lower(replace(source_key, '-', '')) AS message, count(*) AS n
FROM discord_work_operations WHERE kind = 'comment' AND substr(source_key, 1, 8) = 'comment:' GROUP BY 1, 2 HAVING count(*) > 1;
SELECT scope_key, json_extract(payload_json, '$.subject.kind') AS kind, lower(replace(json_extract(payload_json, '$.subject.sourceId'), '-', '')) AS source, lower(replace(json_extract(payload_json, '$.subject.pageId'), '-', '')) AS page, count(*) AS n
FROM discord_work_operations WHERE kind = 'provision' AND state IN ('queued', 'retryable', 'processing', 'held') GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;
SELECT scope_key, conversation_id, count(*) AS n FROM discord_work_operations
WHERE kind = 'refresh' AND json_extract(payload_json, '$.intent') = 'tag-sync'
AND state IN ('queued', 'retryable', 'processing', 'held') GROUP BY 1, 2 HAVING count(*) > 1;
```

Each query should return no rows. If a check returns a conflict or the migration fails on a unique
index, stop the release. Inspect the existing mappings and their Discord and Notion destinations
with a maintainer; reconcile the intended links without deleting provider content, then repeat the
checks and retry the pending migration through the saved release workflow. Do not guess which link
to keep or delete database rows to force the migration through.

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

Administrators can use `/work route-project` to select a Notion source and category for future
project forums, or `/work route-event` to select a source and an existing event channel or forum.
For the LVBT Events source, choose the existing **Status** field and the **Planning**, **Pending
review**, and **Registration open** values. Leave an event as **Not started** while it is a draft;
moving it to **Planning** makes it eligible for a Discord conversation. Including the later active
states keeps it eligible if its status advances before the worker processes it. No separate request
field is needed. After activation, existing eligible events are checked for a uniquely linked forum
post. An uncertain match is held for an administrator to review; it does not create a duplicate
automatically. Use `/work route-event-project` to route events to their related project forums
within an approved category. The event source must have a relation to the configured projects
source; select that field in the preview. If none is available, add a relation property in the event
source that points to the configured projects source, confirm both sources are shared with the
integration, and start setup again. Each event routed this way must have the intended project
selected in that relation. Each event must identify exactly one project with an active, matching
forum. Missing or ambiguous relations, a different audience, or a forum requiring tags stop that
request for review. For each project forum that requires a tag, an administrator can use
`/work project-event-tags` to select up to five tags for future event posts. After saving, open the
route with `/work routes` and choose **Retry checks** for held requests. If the chosen tags are
removed or the forum audience changes, the affected requests stop for review. Review the source,
trigger status, destination, audience, and forum tag. For a separately configured event forum with
optional tags, choose up to five or continue without a tag. A new or edited route is saved paused.
Use `/work routes` to inspect it, select it for management, and choose **Prepare**. The worker scans
existing source records; reopen the route after preparation completes, review the destination and
audience, and explicitly activate it. Existing projects are not automatically backfilled. Existing
eligible events are checked for linked posts, as described below. Newly eligible pages and later
status transitions can create spaces. Choose **Pause** to stop new route-triggered work; existing
project links and conversations remain. Use `/work link` to connect a project directly. The route
management view lists recent requests needing attention and links to their Notion pages. Check the
source, bot access, and destination audience before taking the indicated recovery step. If the
Notion scan is interrupted, check source access and the configured status field. The worker retries
the scan and clears the warning when it successfully reads the next page. If `/work show` reports an
audience or permission change, inspect the linked channel and thread against the approved audience.
Restore the intended access; the worker rechecks it on its next scheduled attempt. Check Message
Content access separately when that is the reported issue.

To synchronize a Notion selection or status to forum tags, open `/work routes`, select the route,
and pause it if it is active. Choose **Map tags**. For a project-category route, select an existing
project forum in that category as the example; other forums need tags with the same names. Choose
the Notion field, select a forum tag for each value, and review the mapping before saving. The route
stays paused: prepare it again, review the audience, and activate it. The mapping accepts up to 25
field values and one tag per value. Missing or ambiguous tags need review; the worker does not pick
an unrelated tag. It preserves tags outside its recorded ownership and stops if an integration-owned
tag was removed by a person. Discord does not offer atomic conditional tag updates, so coordinate
tag edits: a change between the worker's final read and write can still be overwritten. After
restoring a missing tag, correcting the Notion value, or reviewing a tag change that stopped the
worker before its write, open the active route in `/work routes` and choose **Retry checks**. The
worker reads the current tags again before applying the mapping. Uncertain writes remain held until
their outcome is confirmed.

For held requests without a queued Discord operation, **Retry checks** rechecks up to five pages and
their access. It can also retry a project event that failed its required-tag check before any
Discord effect or checkpoint. Requests with a possible Discord effect stay held for reconciliation
to avoid duplicates.

To adopt an existing project overview post, open it in its project forum and run
`/work adopt-project` with the Notion project page URL. Review and confirm the preview. The bot
links the existing post and forum to the project without editing the original post. A project that
is already linked must be reconciled before it can be linked elsewhere.

When an event is listed as needing review because no existing post could be confirmed, inspect the
configured destination for an existing post. If there is none, open `/work routes`, select the
route, and choose the event under **Create a missing event post**. The worker creates the post and
adds its link to the Notion event page. If a post already exists, link that post instead using the
steps below. If a matching post was found but is archived or locked, restore its access or reopen it
in Discord, then choose **Retry checks** for the route. The integration will not offer to create a
second post while that known post is unavailable. The event can stay in its existing status.

To link an existing event thread, open that thread in the configured event destination or project
forum and run `/work adopt-event` with the Notion event page URL. Review the private preview and
confirm it. The bot adds a Notion link to the existing thread and writes the Discord link to the
Notion page. The page must match an active event route; the bot checks the thread parent and
audience again before writing. Private threads cannot be linked because their membership may be
narrower than the parent channel audience.

To create a missing category, use `/work create-category` and review its server-wide audience. To
create a missing events destination inside an existing category, use `/work create-event-forum` or
`/work create-event-channel`. Review the category audience and confirm the request, then use
`/work destinations` to find its result. Choose the created channel in `/work route-event`. If a
request needs review, inspect the server before trying again; a lost response may still mean that
Discord created the channel. For categories, the worker can confirm a matching creation through
Discord's audit log when the bot has `VIEW_AUDIT_LOG`. If evidence is unavailable or ambiguous,
inspect the server and audit log before deciding how to proceed; the creation is not repeated.

The worker queues the project overview pins separately after creating the link. Pinning requires the
bot's `PIN_MESSAGES` permission; if the pin cannot be confirmed, the link still works and
`/work show` reports the issue. Check the post and permissions before pinning it manually. For a
newly created forum, the worker also attempts to pin the overview post if no other post is pinned.
This requires `MANAGE_THREADS`; an unavailable post pin does not prevent the project link from
working. Existing forums retain their pinned post when adopted.

To replace an existing project forum's topic with a link to its Notion project, use
`/work project-topic` and select that forum. Review the current and proposed topics before choosing
**Replace topic**. The worker checks administrator access, the approved audience, the bot's Manage
Channels permission, and the current topic before writing. If the topic changed since review, it
leaves the topic alone; use `/work show` to find the failed request, then review it again. Discord
does not provide an atomic conditional topic update, so an edit made between the worker's final read
and write can still be overwritten. Coordinate the change with other forum administrators. If
Discord's response is uncertain, the request remains held. The worker can confirm it if the exact
requested topic is visible in the same approved forum. Otherwise, inspect the forum with a
maintainer; do not submit another request or change the held operation until its outcome has been
reconciled.

When a project or event title changes in Notion, scheduled refresh updates the bot-authored link
message and the names of forums and posts created by the bot, after rechecking administrator access
and the Discord audience. Existing names stay under organizer control until an administrator runs
`/work sync-name` in the linked forum or post; include the Notion page URL when there is more than
one link. The command also resets the baseline when an administrator wants to resume name sync.

The worker stops managing a name if it differs from the last name it set. Use `/work show` to find
the issue, and use `/work sync-name` only if the name should follow Notion again. It does not reopen
archived posts to rename them. If a post is archived or locked, reopen or unlock it yourself before
running `/work sync-name` to retry. Name changes require the bot's applicable Manage Channels or
thread permissions. A failed rename does not remove the link. Discord cannot make the name check and
update atomic, so an organizer's edit between the final read and write can still be overwritten.

If `/work show` reports an unconfirmed name update, inspect the current Discord name and decide
whether it is safe to use as the new baseline. Then run `/work resolve-name` in that forum or post,
adding the Notion page URL if needed. This retires the held update and uses the observed name for
future sync. If the result remains uncertain, leave it held rather than resolving it. Resolution is
available after the held update has been quiet for at least 15 seconds; review the channel again
before using it. A delayed Discord request cannot be ruled out with certainty.

The jobs worker can reconcile active routes in small pages, retaining its place after temporary
Notion errors. Project and event requests are rechecked before the worker queues provisioning.
Complete the launch checks and verify the actual integration access before activating a route.

After an authorized installation and activation, jobs register `/work` and **Save to Notion** by
name and command type, preserving `/link`, `/checkins`, and other commands. An already registered
command can provide private inspection while sending is disabled; confirmation still cannot queue
outgoing effects until the feature is enabled on the website.

1. An LVBT administrator uses `/work link` with the Notion project URL. Select an existing forum or
   an approved category to create one. To use a text channel or thread as a fallback, explicitly
   select that destination; the preview identifies the fallback.
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
Likewise, retain any created forum, thread, or card until its durable record has been reconciled. If
a page stops matching its route after Discord creation begins, the operation is held for review:
check the page and existing Discord resource. After the page matches the route again, open the
active route in `/work routes` and choose **Retry checks**. This requests verification of the
existing resource; if the worker cannot confirm what was created, the operation remains held.
Recovery inspects up to eight active and archived posts combined. If the archived list is incomplete
or there are more than eight candidates, it cannot establish a unique match and leaves the work for
review. A forum alone does not prove a post was never created. Review those posts and the saved
checkpoint before deciding how to repair.

Scheduled refreshes recheck an active conversation's managed Notion footer. When an organizer adds
content after it, the worker can replace its recorded divider and link at the end while preserving
the organizer's blocks. The original actor's current authority and the approved Discord audience are
checked again before writing. If the footer has been edited or ownership cannot be confirmed, the
repair stops for review rather than replacing that content. Check the affected page and link record
before an authorized organizer repairs or relinks it; do not remove unrelated page blocks.

Use `/work unlink` to stop the current link. Existing discussion and Notion comments remain.
Unlinking invalidates controls and queued effects; it cannot cancel a provider request already in
flight. For a location containing several work references, identify the intended Notion target
before repairing or replacing its link. A relink starts a new activation boundary and does not
silently backfill conversation.

Disable `LVBT_DISCORD_WORK_ENABLED` on both website and jobs to stop all shared effects during
recovery. Preserve database records, credentials, and unrelated integration settings when rolling
back. Retained source text follows the configured source retention policy; provider copies follow
Discord and Notion policy independently.
