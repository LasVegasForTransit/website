# Staff portal setup and release

Maintainers use this page to check configuration and prepare staff access. For the complete
first-time procedure, use [Set up the protected staff preview](../guides/set-up-staff-preview.md).
This reference explains the settings and checks required by those steps.

The staff application serves `staff.lasvegasfortransit.org`. Its protected preview serves
`staff-preview.lasvegasfortransit.org`. The scheduled jobs Worker has no public route. All three
applications, including the public website, use the same membership tables; preview uses a separate
database and Discord server.

Staff and jobs use a separate release process from the public website. Follow
[Staff release and recovery](./staff-release-operations.md) for publication, launch approval and
recovery requirements.

For routine administrator changes after first-time setup, use
[Manage staff administrators](../guides/manage-staff-administrators.md). It covers adding and
removing people through the portal and the separate Google Group prerequisite.

Choose the reference for your task:

- [Background work and database limits](./staff-background-work.md) explains usage, stopped jobs and
  wake signals.
- [Newsletter delivery and cleanup](./staff-newsletter-operations.md) covers Beehiiv setup and staff
  follow-up.
- [Staff release and recovery](./staff-release-operations.md) covers saved builds, activation and
  failed deployments.
- [Committee accounts and organization roles](./staff-account-integrations.md) covers Discord and
  Google access.
- [Staff acceptance](./staff-portal-acceptance.md) lists the real tasks and outside-service checks
  required before launch.

## Read-only configuration check

The [staff environment example](../../apps/staff/.env.example) lists the Access binding names.
Deployment uses the reviewed values in the selected `wrangler.jsonc` environment: its own Access
application's audience and the team's hostname, without a scheme or path. Keep production and
preview audiences separate. Use synthetic Access identities in the local browser fixtures; never
copy a production session into a test.

From the repository root:

```sh
pnpm staff:preflight --preview
pnpm staff:preflight --preview --setup
pnpm --silent staff:preflight --production --json
```

The command reads local Worker configuration and migration filenames. With `CLOUDFLARE_ACCOUNT_ID`
and an approved `CLOUDFLARE_API_TOKEN` in the environment, it also reads bindings of every actively
served Worker version, active deployments, custom domains for the selected staff and jobs Workers,
schedules, Access applications and every page of their policies. It checks jobs subdomain flags,
custom domains and ordinary routes in every accessible account zone. Its only POST is the fixed
`SELECT name FROM d1_migrations ORDER BY id` metadata query. It never creates resources, changes
secrets, applies migrations, deploys code or prints provider response bodies.

Limit Worker edit access to the selected staff and jobs Workers. Custom-domain inventory requires
account-wide **Workers Metadata Read-Only**; this includes settings, metrics and logs for production
Workers, so obtain maintainer approval for that scope. The checks also need Access applications and
policies Read, D1 Read, and Zone Read and Workers Routes Read across the account's zones. D1 Read
permits reading database records, including member data; the command itself only queries migration
names. Custom-domain queries include the selected Worker name instead of asking for all Workers'
domains. A denied or incomplete inventory is reported as **unverified**. The command does not load
or transfer another tool's login. Never paste a token into a command argument or save it in a
tracked file.

Exit status 0 means all inspected configuration requirements passed. It does **not** mean the portal
is ready for staff: the report separately lists live acceptance as unverified. Exit status 1 means
configuration is missing, invalid or unverified; 2 means invalid command arguments. The command
defaults to preview and rejects selecting both environments.

`--setup` checks whether the protected preview can be deployed for sign-in and staff workflow
testing before Discord is configured. It requires the same authentication, Access, isolated
database, migrations and exposure checks. Both source configurations and every active Worker version
must explicitly keep Discord disabled, and jobs must have no cron triggers. Only the Discord launch
configuration, bot-token and minute-schedule requirements can remain incomplete. The JSON includes
`stage: "setup"` and `setupReady`; it retains every launch check and unverified acceptance item.
This mode is refused for production and does not establish launch readiness.

`--shutdown` verifies a completed preview shutdown: both active Workers must have Discord disabled,
newsletter work must remain disabled, and jobs must have no cron triggers. It retains the Access,
database, authentication and exposure checks and requires the same isolated Discord target in source
and active versions. The JSON includes `stage: "shutdown"` and `shutdownReady`; disabled Discord
launch checks remain visible. This read-only check does not disable anything and cannot prove that
website linking is off or that a prior provider request has finished.

Newsletter work must also remain disabled during setup. The jobs source configuration must set
`LVBT_BEEHIIV_SYNC_ENABLED=false`; any deployed version with this binding must expose the same
plain-text disabled value. A missing deployed binding does not enable newsletter work. Setup checks
reject newsletter activation both before upload and before activating the saved release. Provider
credentials and live newsletter acceptance belong to the separate launch configuration.

For newsletter scan timing, incoming events and recovery evidence, use
[Inspect saved newsletter processing](./staff-newsletter-operations.md#inspect-saved-processing).

## Maintainer setup

Use the existing values and approved applications in the
[Worker runtime configuration](../../packages/platform-integrations/src/worker-runtime-config.ts),
following [platform secrets](./platform-secrets.md). Production credential setup or rotation
requires explicit maintainer authorization for the account, permissions and destination. An
authorized operator or agent may perform that setup; keep credential values out of source and
operational reports.

1. Confirm the selected Cloudflare account and database. Production uses `lvbt-platform`; preview
   uses `lvbt-platform-preview`. Site, staff and jobs must bind the same database within each
   environment and use `packages/platform-storage/migrations`.
2. Create the dedicated `console-users@lasvegasfortransit.org` Workspace group. Admit only approved
   team members who are already LVBT members. Group entry grants no administrator permissions.
3. Protect each exact staff hostname with its own Access application and matching audience. Set
   application and policy sessions to 12 hours. Allow the Console users Google group and require the
   LVBT email domain. Do not add bypass policies or broader alternative allow rules. Review the
   Google identity provider and actual group membership separately.
4. Configure the dedicated
   [production staff Google client](./platform-secrets.md#google-sign-in-for-the-staff-portal) and
   [staff email key](./platform-secrets.md#staff-email-key). Use
   [staff preview setup](../guides/set-up-staff-preview.md) for the shared preview credentials and
   fixed preview callbacks. Keep dynamic preview origins disabled unless explicitly approved.
   Configure the approved sign-in and email bindings on staff. Sessions and confirmation cookies are
   scoped to their issuing host, so staff can use an independent `LVBT_SIGN_IN_SECRET` while sharing
   the membership database. Preserve the website's existing signing key; rotating it invalidates its
   member sessions. Confirm a real sign-in on each application before acceptance.
5. Add the non-sensitive Access audience and team domain to the staff source configuration's Worker
   variables for each environment before building the release. Upload replaces public variables;
   values added only to the remote Worker are not inherited. If an audience is stored as an opaque
   secret, its value cannot be compared through metadata: a maintainer must verify it without
   disclosing it. Do not rotate credentials to make an inventory pass.
6. Put the approved Discord bot token on jobs only. Staff needs the public Discord configuration,
   and the public site needs its existing OAuth client configuration for account linking. Use a
   separate preview server. Review the Member role and every committee's current and retired role
   mappings; confirm the bot can manage them while leaving unrelated roles alone. Enable Server
   Members Intent for roster review, and grant the bot Manage Roles and Create Invite. The public
   website must bind `LVBT_DISCORD_JOBS` to `lvbt-jobs` in production or `lvbt-jobs-preview` in
   preview. Joining passes the member's request-only Discord token over that private connection; the
   jobs Worker checks the matching environment and current membership. Keep direct jobs URLs
   disabled. Test joining, server-rule acceptance, retry, and multiple committee roles in the
   isolated preview before enabling production. Account disconnection must also be tested: confirm
   member and committee channel access ends while server membership and unrelated roles remain.
   Disconnection retains its verified account target until the reconciler confirms removal; failed
   requests recover through the same scheduled work. Apply the migration that saves pending account
   disconnections before publishing these controls.
7. After the selected staff release is activated, and before the first administrator signs in, set
   the temporary secret `LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL` on the active staff Worker to the
   president's exact `@lasvegasfortransit.org` account. On `lvbt-staff-preview`, use an approved
   Google account linked to a clearly marked test member in the isolated preview database. This may
   be an existing staff Google account; do not copy production member records or permissions. Do not
   store this value in source control or use a personal email. The one-time setup page checks that
   this exact Workspace account is linked to an active LVBT member and that no administrator
   designation exists, then records the grant in the staff audit log. The president signs in with
   Google, completes any inbox confirmation needed to link their member record, then completes the
   first-administrator setup. Confirm the audited designation and access to the member list, then
   remove the temporary secret. Sign out and sign in again through the normal Google flow; verify
   that the member list opens without the temporary setting. Do not infer admin access from a domain
   or group alone.

## Historical roster preview

Use [Import existing member records](../guides/import-existing-members.md) for the actual
database-aware dry run, reviewed apply, and recovery procedure. The command below only checks a
normalized file.

Give the read-only import command a reviewed JSON array normalized to the roster evidence fields. It
prints aggregate counts and row numbers with conflict reasons; it omits email addresses and provider
IDs. It does not write member records or a report file.

Optional `givenName` and `familyName` fields retain names supplied with the source roster. Each
accepts up to 100 characters; surrounding whitespace is removed and blank values are ignored.
Imports fill missing names and preserve details already recorded, including a staff correction made
while the import is being saved.

```sh
pnpm --filter @lasvegasfortransit/site roster:preview --input /private/path/roster.json
```

Keep the input file and terminal output in an approved private workspace. Review source totals,
original consent evidence, and duplicate resolution before any import is separately authorized. This
preview command has no apply option.

## Verification still required

Run `pnpm check`, then the compiled runtime suites sequentially after the build has finished:

```sh
pnpm -C apps/jobs test:maintenance
pnpm -C apps/jobs test:e2e
pnpm -C apps/staff test:e2e
pnpm -C apps/staff test:audit
pnpm -C apps/staff test:release
pnpm -C apps/site test:account-data:lighthouse
```

The account-data fixture covers authenticated download and deletion, including JavaScript-disabled
forms; its accessibility and Lighthouse checks use local fixtures only.

The staff audit uses an isolated compiled Worker with synthetic Workspace sessions and Access
assertions. It checks administrator and committee-lead pages, paper entry and its printable sheet,
welcome pages, and the signed-out, membership-confirmation and initial-administrator screens with
axe at phone and desktop widths. It also checks the dark member roster, native keyboard search with
JavaScript disabled, and a 35 KB gzip JavaScript limit per audited route, including imported modules
and scripts blocked by CSP. Lighthouse audits the authenticated Members page with the existing
mobile limits: accessibility at least 0.95, performance at least 0.85, best practices at least 0.90,
largest contentful paint (LCP) at most 4 seconds, total blocking time (TBT) at most 300 ms, and
cumulative layout shift (CLS) at most 0.1. An authentication redirect, HTTP refusal or audit runtime
error fails the gate. `Build staff release` requires this audit before saving a release. Local
reports are saved under `apps/staff/test-results/staff-audit/`; CI saves the synthetic reports as a
separate artifact. Inspect the named route and report when a check fails, fix the defect, then rerun
the same command after the compiled build is stable. Keep thresholds and authorization checks
intact.

The print-sheet keyboard check requires native arrow scrolling when its region scrolls and visible
content on desktop when it does not. Width overflow alone does not identify a scroll container.

On GitHub's Linux runners, the Lighthouse fixtures launch bundled Chromium with `--no-sandbox`
because the runner disallows its sandbox. That exception applies only when `CI=true` on Linux, and
the audit browser is restricted to the isolated local fixture. Local runs retain Chromium's sandbox.
A Chrome launch failure is an incomplete audit; inspect the runner log and repair its configuration
before rerunning the same checks. Do not lower accessibility or performance thresholds to clear it.

These use synthetic data and isolated providers. They cannot prove real Google sign-in, a complete
imported roster, Discord server operation, Google Group or mailing-list synchronization, production
deployment, or staff usability. Record real administrator, committee-lead and refused-account
outcomes, independent provider checks and failure recovery, three staff sessions including assistive
technology, and the agreed week of production use before declaring launch complete. Keep member
contact data and private task tracking out of public release evidence.

## Staff request failures

For maintainers investigating an unavailable staff page, check Worker logs for
`staff_request_failed`. The record includes the request layer, a generated request ID and a fixed
failure category. `database_read_limit` identifies an exhausted D1 read allowance, including a
nested database error. `database_write_limit` identifies exhausted writes. `unexpected` requires
further investigation. Logs deliberately omit exception text, SQL, request URLs, cookies and member
details.

The staff gateway replaces server errors and unknown pages with an LVBT recovery page. The page
contains its own styles, Public Sans font and LVBT marks and needs no database, scripts or asset
requests. Its brand data is generated from the normal staff and public-site sources. After changing
those sources, run `pnpm -C apps/staff brand:recovery` and review light and dark desktop and phone
renders. Staff builds and synchronization reject stale generated brand data. Staff and volunteers
get contact and navigation links without provider diagnostics. After a failed submission, they must
check the saved record before submitting again because a response failure does not prove that the
write failed.

For `database_read_limit`, follow the
[allowance recovery procedure](./staff-background-work.md#keep-background-work-within-the-shared-database-allowance).
A new error page does not restore database availability. After the allowance resets, verify sign-in
and member search through the protected release flow, then inspect usage across scheduled ticks. Do
not upgrade billing or bypass release gates as an incident workaround.

Use [Investigate a staff failure](../guides/investigate-staff-failures.md) to look up a reported
reference and interpret its private diagnostics.

The [staff availability target](staff-availability.md) defines the measurement and release evidence
needed before claiming 99.9% availability.

## Earlier section links

Older links to this page still resolve here. Follow the matching link for the current procedure.

| Section                                                                                                                         | Current page                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| <a id="keep-background-work-within-the-shared-database-allowance"></a>Keep background work within the shared database allowance | [Open the procedure](staff-background-work.md#keep-background-work-within-the-shared-database-allowance) |
| <a id="inspect-scheduled-wakes"></a>Inspect scheduled wakes                                                                     | [Open the procedure](staff-background-work.md#inspect-scheduled-wakes)                                   |
| <a id="scheduled-newsletter-processing"></a>Scheduled newsletter processing                                                     | [Open the procedure](staff-newsletter-operations.md#scheduled-newsletter-processing)                     |
| <a id="rehearse-beehiiv-with-one-approved-address"></a>Rehearse Beehiiv with one approved address                               | [Open the procedure](staff-newsletter-operations.md#rehearse-beehiiv-with-one-approved-address)          |
| <a id="resolve-newsletter-follow-up"></a>Resolve newsletter follow-up                                                           | [Open the procedure](staff-newsletter-operations.md#resolve-newsletter-follow-up)                        |
| <a id="verify-newsletter-cleanup-after-account-deletion"></a>Verify newsletter cleanup after account deletion                   | [Open the procedure](staff-newsletter-operations.md#verify-newsletter-cleanup-after-account-deletion)    |
| <a id="prepare-the-isolated-discord-preview"></a>Prepare the isolated Discord preview                                           | [Open the procedure](../guides/test-discord-preview.md#prepare-the-isolated-discord-preview)             |
| <a id="run-an-approved-isolated-discord-preview"></a>Run an approved isolated Discord preview                                   | [Open the procedure](../guides/test-discord-preview.md#run-an-approved-isolated-discord-preview)         |
| <a id="release-order-and-rollback"></a>Release order and rollback                                                               | [Open the procedure](staff-release-operations.md#release-order-and-rollback)                             |
| <a id="prepare-the-saved-artifact"></a>Prepare the saved artifact                                                               | [Open the procedure](staff-release-operations.md#prepare-the-saved-artifact)                             |
| <a id="shut-down-the-isolated-discord-preview"></a>Shut down the isolated Discord preview                                       | [Open the procedure](staff-release-operations.md#shut-down-the-isolated-discord-preview)                 |
| <a id="publish-an-approved-staff-production-release"></a>Publish an approved staff production release                           | [Open the procedure](staff-release-operations.md#publish-an-approved-staff-production-release)           |
| <a id="prepare-the-first-production-baseline"></a>Prepare the first production baseline                                         | [Open the procedure](staff-release-operations.md#prepare-the-first-production-baseline)                  |
| <a id="activate-the-selected-production-release"></a>Activate the selected production release                                   | [Open the procedure](staff-release-operations.md#activate-the-selected-production-release)               |
| <a id="recover-a-failed-preview-activation"></a>Recover a failed preview activation                                             | [Open the procedure](staff-release-operations.md#recover-a-failed-preview-activation)                    |
| <a id="inspect-with-an-approved-local-credential"></a>Inspect with an approved local credential                                 | [Open the procedure](staff-release-operations.md#inspect-with-an-approved-local-credential)              |
| <a id="interpret-safe-release-diagnostics"></a>Interpret safe release diagnostics                                               | [Open the procedure](staff-release-operations.md#interpret-safe-release-diagnostics)                     |
| <a id="activate-and-verify"></a>Activate and verify                                                                             | [Open the procedure](staff-release-operations.md#activate-and-verify)                                    |
| <a id="committee-discord-channels"></a>Committee Discord channels                                                               | [Open the procedure](staff-account-integrations.md#committee-discord-channels)                           |
| <a id="review-unlinked-discord-accounts"></a>Review unlinked Discord accounts                                                   | [Open the procedure](staff-account-integrations.md#review-unlinked-discord-accounts)                     |
| <a id="organization-roles"></a>Organization roles                                                                               | [Open the procedure](staff-account-integrations.md#organization-roles)                                   |
| <a id="google-committee-access"></a>Google committee access                                                                     | [Open the procedure](staff-account-integrations.md#google-committee-access)                              |
| <a id="inspect-google-setup-without-granting-access"></a>Inspect Google setup without granting access                           | [Open the procedure](staff-account-integrations.md#inspect-google-setup-without-granting-access)         |
| <a id="review-committee-account-access"></a>Review committee account access                                                     | [Open the procedure](staff-account-integrations.md#review-committee-account-access)                      |
