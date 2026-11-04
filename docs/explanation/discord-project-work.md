# How Discord project work is connected

Use this explanation when changing the Notion-to-Discord integration or deciding where to repair a
broken link. For setup, permissions, and recovery steps, use the
[project conversations guide](../guides/set-up-discord-project-work.md).

## Ownership and boundaries

This website repository owns the integration. Its jobs Worker reads Notion, calls Discord, and
stores link and operation records in the platform database. The website verifies Discord
interactions and passes work to the jobs Worker's `WorkPreview` entrypoint. The jobs environment
holds the Notion and Discord secrets; the website does not need those provider tokens. Preview and
production use separate configuration and database scopes. The
[task integration guide](../guides/set-up-task-check-ins.md) names the settings and secret store.

This identifies the code and runtime, not an individual service owner. LVBT still needs to identify
the maintainer responsible for the deployed integration and confirm the provider connections before
launch. Docket tracks the work and does not route or synchronize Notion and Discord.

## From a plan to a conversation

An administrator approves a reusable route from a Notion data source and selected status or
selection values to a Discord destination. Project routes use a category for per-project forums.
Event routes use an events channel or forum, or a relation to a project whose forum already exists.
The administrator can instead link or adopt an individual destination. A route begins paused; a
baseline scan records existing pages before activation. Existing projects are not automatically
backfilled. Existing eligible events are checked for a uniquely linked forum post; uncertain matches
are held for review rather than creating another post.

The jobs Worker periodically scans a small page of the source, saves its cursor, and records
eligibility observations. A newly eligible page or an eligible transition creates a durable request.
Before creating anything, the worker reads the current page again and checks the route, approving
administrator, destination, and audience. The implementation currently uses scheduled
reconciliation; it does not rely on a Notion webhook for this flow. A successful creation stores the
Discord forum or thread and the managed message before the worker writes the link at the end of the
Notion page.

For example, an event related to one approved project can use that project's forum. If the relation
is missing or ambiguous, or the forum audience differs from the approved route, the request needs
review. It does not choose another channel silently. If the Discord conversation exists but the
Notion footer needs repair, the worker can retry the missing link without creating another post.

## Identities and recovery

The database scopes work by environment, Discord server, and Notion workspace. Routes identify a
source by its Notion data source ID. A project home links a Notion source and page ID to its Discord
destination. A conversation links a source, page, and subject kind to its Discord thread and managed
message IDs. Names and titles are display information, not identities. Equivalent capitalization and
hyphenation of a Notion UUID identify the same source or page.

Only one active route may own a source within a scope. Non-unlinked homes and conversations also
have uniqueness checks, as do in-flight provisioning requests for the same subject. Existing
conflicts stop the relevant migration for review. Administrators can adopt an existing forum or
thread; the saved link records its destination and managed message rather than taking ownership of
human-authored text.

An operation records its state, actor, source key, and claim lease. A worker checks that its lease,
link generation, and authorization are still current before provider writes. A known retryable
failure can be retried; an uncertain write is held until there is positive evidence of its outcome.
For example, a lost forum-topic response can be confirmed when the requested topic is visible in the
same approved forum. Otherwise the operator must inspect the result instead of blindly retrying. See
the setup guide for the exact recovery steps and migration checks.

## Access and current limitations

An administrator approves each Discord audience. The integration cannot reproduce individual Notion
page permissions, so operators must ensure the selected destination is suitable before linking. The
worker compares the destination's audience with the approved value and stops affected work if it
changes. It sends the information needed for the link and selected shared-work features; it does not
copy a complete planning page into Discord.

The current implementation can set an existing forum topic after explicit review, but Discord does
not provide an atomic conditional topic update. An edit made between the final read and write can
still be overwritten. Project and event title changes refresh a bot-authored card; forum and thread
names are not automatically renamed, and an event's date is not synchronized to that card. An
administrator can map one Notion selection or status to tags for existing forum posts. For project
routes, each forum needs the mapped tag names. Discord cannot conditionally update a tag set, so an
edit concurrent with the final read and write may be overwritten. Provider access and the real
mobile volunteer journey require live acceptance; local tests do not establish either.
