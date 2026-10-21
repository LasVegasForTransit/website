# Staff committee accounts and organization roles

Staff administrators use this reference to connect committee roles and review account access.
Maintainers use the setup sections to understand which Discord and Google features can run. A
confirmed provider observation means the application checked the account or role in the outside
service; a queued request alone does not confirm access.

Before configuring accounts, complete [staff setup](./staff-portal-operations.md#maintainer-setup)
and select the intended environment. Google group automation still lacks its hosted runner and token
source. Continue approved manual administration in Google Admin until that work and live acceptance
are complete.

Choose the section for your task:

- [Committee Discord channels](#committee-discord-channels).
- [Review unlinked Discord accounts](#review-unlinked-discord-accounts).
- [Organization roles](#organization-roles).
- [Google committee access](#google-committee-access).
- [Review committee account access](#review-committee-account-access).

## Committee Discord channels

Use an isolated Discord server for the preview. An administrator chooses the server's existing roles
in **Committees → the committee → Edit committee → Account connections**. Staff never need to copy
Discord role IDs. A lead receives the committee role plus its optional lead role; each committee
assignment remains independent.

Before using these controls:

1. Back up the selected membership database and rehearse its pending migrations using the
   [backup guide](../guides/back-up-membership-database.md). Apply the reviewed database migrations,
   including `0042_committee_discord_leads.sql`, through the approved release path before activating
   the corresponding staff and jobs build.
2. In Discord, create or identify the committee's channel roles. Place the bot's role above every
   role it must assign or remove, including previously used committee roles. Give the bot the
   approved Manage Roles and Create Invite permissions. Do not grant Administrator to make these
   controls work.
3. Keep the bot token on the jobs Worker only. Staff uses the existing `LVBT_NEWSLETTER_JOBS`
   private service binding to the matching jobs environment for read-only role choices and validated
   saves. Both Workers need matching public Discord configuration, and synchronization must be
   enabled for that environment. Keep direct jobs URLs disabled. A setup preview with
   synchronization disabled intentionally cannot change Discord connections; staff can still save
   other committee details.

To configure a committee:

1. Sign in as a staff administrator and open **Edit committee → Account connections**.
2. Choose **Committee Discord role** from the list. Choose **No committee role** to stop assigning a
   committee-specific role. The general LVBT Member role is configured separately and does not
   appear among these choices.
3. If leads need additional channels, choose **Lead Discord role (optional)**. Otherwise leave **No
   extra lead role** selected. Use a different role from the committee role.
4. Select **Save committee**. The server reads the current Discord hierarchy again before saving. If
   a choice became unavailable, choose from the refreshed list. Unavailable connections are kept
   when staff only changes committee details; they cannot be used for a new connection.
5. With an approved linked test member, confirm the committee's channels work. Promote the member to
   lead and confirm the extra channels work. Change them back to member and verify only lead access
   ends. Repeat with a second committee to confirm its access remains independent. Verify actual
   roles in Discord as well as the member's **Accounts** section in staff.

The list excludes the Member role, integration-managed roles, roles at or above the bot, and roles
reserved for another committee or assignment kind. Empty or unavailable choices require an operator
to check the server configuration; do not paste a role ID or grant wider permissions as a
workaround. Changing or clearing a connection retains its previous role for cleanup. Never repurpose
a retired managed role for another committee or assignment kind. Confirm its removal from the
approved test account while unrelated server roles remain. Accounts without a connected member
record are flagged for staff review; this configuration does not authorize removing their roles.

## Review unlinked Discord accounts

Administrators use **Google and Discord access → Discord accounts to check** to recognize accounts
with managed roles that are not connected to an active member record. Each row shows the server
nickname, global display name or username, followed by the username when available and the relevant
LVBT roles. Provider names are only clues: open the Discord profile to check the account, then ask
the member to connect Discord from their own LVBT account. Staff cannot confirm ownership or remove
an unlinked account's roles from this review list.

Apply the `0046_discord_review_names.sql` database migration before activating the corresponding
staff and jobs applications, following
[Activate and verify](./staff-release-operations.md#activate-and-verify). It adds nullable name
fields and an erasure trigger without changing existing roles or review dates. The guarded website
promotion applies the saved release's SQL using its existing migration credential; staff release
verifies the schema before activation. Select a saved release containing migration 0046 before
activating the new staff and jobs applications. No new provider permissions or credentials are
required. Existing rows initially show **Account name unavailable**. Names fill in as each account's
page is read by the next normal guild scan, which reads at most 1,000 accounts per scheduled
invocation. Accounts already passed by an in-progress scan wait for the following scan. There is no
provider lookup when staff opens the page.

If names remain unavailable, check that the matching jobs version is active, the normal schedule is
running, and the guild-roster checkpoint's page, account and error counts are advancing. Follow the
existing provider retry and schedule recovery procedures; do not delete checkpoints or change roles
to force a name refresh. Missing provider fields and erased accounts intentionally have no names.
Erasure clears the local name snapshot immediately, and later scans must not restore it, including
after the member profile's retention purge. An opaque Discord account marker preserves that
suppression after a queued disconnect removes the identity link; it contains no names or contact
fields. Account IDs and role observations remain for access cleanup. A completed guild scan removes
rows that no longer need review. Application rollback keeps this additive migration and its erasure
trigger in place.

## Organization roles

Organization roles describe a person's LVBT responsibilities independently of committee
associations. Staff define the available names in **Members → Member records → Manage roles**, then
assign them in the person's **Roles** section. See
[Manage member roles](../guides/manage-member-roles.md) and
[Manage a person's committees](../guides/manage-member-committees.md).

Before activating a release that uses organization roles:

1. Back up the selected membership database with the normal protected release procedure.
2. Apply the saved release's database migrations through the website publication path, including
   `0047_organization_roles.sql`, before activating its staff and jobs applications.
3. Verify the selected applications against the updated schema. Confirm an authorized administrator
   can define a role and assign it to a consenting member without changing their committees.
4. Confirm role definitions and that member's assignments appear in the appropriate administrator
   download, and that a member download contains only that member's assignments.

The catalog starts empty; old committee-lead assignments are not organization roles. Defining or
assigning a role does not grant staff permissions or change provider roles. Existing administrator
and committee-lead access remains separate. Retiring a definition prevents new assignments while
preserving existing assignments and their history.

An application rollback retains this additive migration and its erasure guards. Do not reverse the
migration or restore erased assignments. Use the normal recorded-version recovery procedure when an
activation outcome is uncertain.

## Google committee access

The Google Directory adapter reconciles verified linked accounts against current and retained
committee group mappings. After checking a group in Google, the adapter saves the result for five
minutes so an interrupted job can resume. It confirms the account only after it has checked every
group in the current plan. That confirmation expires when the earliest group check expires.
Future-dated checkpoints cannot confirm current access. It does not complete Discord or mailing-list
work. Migration 0026 preserves existing Discord audit intents and adds Google intents and group
checkpoints; a maintainer must review and apply it with the other reviewed database migrations
before running this code against hosted data.

To grant access, the adapter requires the exact linked user ID, primary email and Workspace customer
ID, which identifies LVBT's Google organization. Suspended, archived, renamed or mismatched accounts
are refused. Existing owners and managers keep their role while assigned; withdrawal removes the
selected direct membership regardless of role. Removal uses the stable user ID and can continue
after personal email has been erased. The adapter also checks
[effective membership](https://developers.google.com/workspace/admin/directory/reference/rest/v1/members/hasMember).
Inherited access remains an unresolved removal; the job does not modify unrelated ancestor groups or
report that access is gone.

The storage layer now supports a customer-scoped hourly drift scan. It pages through verified Google
links, includes former members for removal, and queues current work without storing contact details
in the checkpoint. This scanner is not yet connected to a hosted Google runner, so it does not by
itself produce or refresh provider observations.

Google quota deadlines are saved per Workspace customer so a new Worker instance honors a 429
response and stops selecting accounts until the deadline. Migration 0028 preserves existing Discord
pauses and must be reviewed and applied before hosted Google execution.

The group inventory reader lists registered groups independently of linked member records, using
[Directory membership pages](https://developers.google.com/workspace/admin/directory/reference/rest/v1/members/list)
with indirect membership included. It returns a complete in-memory inventory or fails without a
partial count. It preserves owners, managers and nested-group entries and counts each user once.
Domain-wide or unresolved external entries make the exact user count unavailable. Pagination is
limited to 50 pages of 200 entries within 30 seconds. A changed group ID, conflicting duplicate,
repeated cursor, malformed response or lost authorization invalidates the read. The reader changes
no memberships. Complete inventories can be saved atomically through the collection layer, retaining
only account IDs, types and roles. Migration 0032 adds this cache and failure metadata. Checks stay
current for five minutes; maintenance removes unused inventories after 24 hours. The administrator
view reads stored counts and differences without calling Google. Names and contact details come from
current authorized LVBT records, including after erasure. Failed, stale, incomplete and unconfigured
checks cannot confirm a count or offer mismatch actions. Accounts without a unique verified member
identity remain an aggregate review in Google Admin. Hosted collection still needs a verified Google
runner.

Supply complete, disjoint preview and production group registries, including retired mappings.
Missing mappings or credentials must remain unconfigured. Group renames, inherited access and
linked-account changes need review; do not broaden the registry or bypass identity checks to clear a
failure.

The adapter accepts an injected token source and has no service-account-key fallback. Hosted
dispatch and the token source are not wired. The GitHub Actions route in
[the organizing-platform decision](../explanation/decisions/organizing-platform.md) is historical;
it does not establish an identity for the private jobs Worker. Before setup, separately authorize
the exact matching private jobs identity, environment, audience, Google-managed signing permission
and dedicated delegated Workspace administrator. Do not grant broad impersonation roles as a
substitute for that decision.

The adapter's data operations require these Directory scopes. This list describes its API needs; it
is not an approved domain-wide delegation grant:

- `https://www.googleapis.com/auth/admin.directory.user.readonly`
- `https://www.googleapis.com/auth/admin.directory.group.readonly`
- `https://www.googleapis.com/auth/admin.directory.group.member`

The staff Worker can display those saved observations without receiving Google credentials. Keep
`LVBT_GOOGLE_ACCESS_OBSERVATIONS_ENABLED` false until the Workspace customer context is verified.
Both environments use LVBT’s pinned Workspace customer: `LVBT_GOOGLE_CUSTOMER_ID` must match
`LVBT_GOOGLE_PRODUCTION_CUSTOMER_ID`. Isolate preview writes using different committee groups, not
another tenant for the same domain. Set `LVBT_GOOGLE_MANAGED_GROUPS` to a JSON array containing all
current and retained groups this environment may reconcile. Set `LVBT_GOOGLE_PRODUCTION_GROUPS` to
the complete production registry; preview managed groups must be disjoint from it, while production
managed groups must belong to it. Missing or conflicting registries leave observations unconfigured.
These values recognize saved observations; they do not enable the Google runner or prove access.

`LVBT_GOOGLE_CONSOLE_GROUP_EMAIL` explicitly registers the existing staff sign-in group for
read-only inventory. It must not overlap managed write groups. Its current user count appears
separately from committee groups, with an access-review reminder at 45 people. This counts Google
group members, not Cloudflare billable seats. The inventory view can be configured for this
read-only group alone without enabling committee reconciliation.

Inspect the approved service account, current principal and audience restrictions, dedicated
delegated administrator and Workspace customer read-only before enabling execution. An existing
service account alone does not prove that runtime trust or delegation exists. Keep tokens out of
saved builds, artifacts, logs and source control. Do not create a key or relax organization policy
when setup is unavailable. Before production use, an approved preview test must grant access, check
it independently, remove it and verify recovery after a failed request.

### Inspect Google setup without granting access

Google sign-in and Google group automation use different permissions. Complete these checks before
preparing any grant:

1. In Google Cloud, select project **LVBT Core** (`lvbt-core`) and open **IAM & Admin → Service
   Accounts**. Inspect the service account named in the current approved setup, if one exists,
   including **Keys**, without creating or downloading one. The existing
   `lvbt-website-admin@lvbt-core.iam.gserviceaccount.com` is not automatically the approved jobs
   signer. An empty key list is compatible with a keyless design, not proof of automation.
2. Open **IAM & Admin → Workload Identity Federation**. Inspect existing pools, providers, and
   service-account permissions. Compare exact issuer, principal, environment, allowed audience and
   signing permissions with the approved private jobs setup. A **Get started** page shows no
   configured pool in that view; it does not prove all IAM is empty. A service account existing by
   itself does not establish this trust.
3. In Google Admin, open **Security → Access and data control → API controls → Manage Domain Wide
   Delegation**. If a signer is approved, find its numeric client ID and inspect its approved
   scopes. An empty list or missing client means delegated Workspace access is unconfigured. Do not
   use **Add new** as part of this read-only check.
4. Verify the Workspace customer, dedicated delegated administrator and scope set against the
   current approved private jobs design. Historical Actions and delegated-account choices are not a
   deployable hosted identity. Resolve the exact runtime authentication and authorization before
   granting permissions. Do not invent a Worker identity source or install a long-lived key as a
   shortcut.
5. Keep observations and writes disabled until the runner, token source, and actual provider tests
   are implemented and verified. Continue approved manual group administration in Google Admin.

If Google requests a passkey, the account owner completes it. Inspect Cloud and Admin separately;
successful sign-in to either service does not prove the other's configuration.

## Review committee account access

Administrators open **Members → Google and Discord access**. The committee table compares current
LVBT assignments with the last stored Google and Discord checks. It starts with committees that have
accounts set up; select **All committees** to include the rest. It never contacts a provider when
someone opens the page. Counts describe confirmed access; unconnected, ambiguous and stale accounts
remain separate. Discord is optional, so an unconnected account is not a reason to remove someone
from a committee.

1. Open a committee to review its Google and Discord differences. Confirm the checked date before
   acting. A missing or stale check cannot confirm that someone has access or that access was
   removed.
2. Compare **Expected access** with **Confirmed access**. Discord roles shared by committees use all
   current committee entitlements. A person entitled through another committee is not an unexpected
   holder. Member and committee-lead access remain separate.
3. For Google, select **Review Google access** for the current group and its existing correction
   actions. **Add to committee** changes the member's saved committee assignment. Removing an
   unexpected Google holder leaves their LVBT membership intact and records **Removed from access
   page**. Inherited access must be reviewed in Google Admin; a direct group removal cannot
   establish that inherited access ended.
4. Open a member for committee changes or an access retry. A retry records who requested it and the
   reason. Requests are not completed access changes; only a confirmed provider change appears in
   the corrections list. Unmatched Discord accounts stay unchanged while staff reviews them.
5. Review **Discord corrections in the last seven days** for completed changes. The member profile's
   **Access history** retains the longer administrator-only history, including automatic changes and
   the staff requester when available.

Migration `0043_access_mismatch_observations.sql` adds operational first-noticed dates for known
Google direct membership and Discord role differences. Apply all database migrations in order before
uploading this version, following
[the preview upgrade procedure](../guides/set-up-staff-preview.md). A complete Google inventory and
a current known Discord read can establish a date. Unknown, incomplete or superseded checks cannot
create a false first-noticed date. A confirmed correction clears the old date; a later recurrence
starts a new one. Older stored checks without this evidence do not invent a date. Archived or erased
member rows clear these observations; undoing a combination requires a fresh provider check rather
than restoring old access evidence.

All access systems write through `accessChangeWrite` in `platform-storage/access-audit`. Callers
must first confirm a real grant, revocation, suspension, restoration, transfer or deletion and
retain their transaction's ownership guard. Set `changed` false for an unchanged operation. Use a
stable operation ID, a supported system and reason, the affected person, resource and actual actor.
The writer accepts no free-form details or message bodies. Google and Discord confirmation paths use
this same writer with their existing checks that the operation still owns the account and matches
its latest state. Workspace-account, GitHub and checklist callers can use it without claiming that
those integrations are deployed.

`listAccessChanges` reads the same immutable history for all systems. Its filters, current
administrator check and newest-first pagination run against stored records. Privacy erasure redacts
personal details while retaining the permitted action, actor and time; the reader never reconstructs
redacted targets. Ordinary updates cannot edit the log. The existing three-year maintenance policy
applies to every supported action.
