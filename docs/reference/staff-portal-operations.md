# Staff portal setup and release

For the complete first-time procedure, use
[Set up the protected staff preview](../guides/set-up-staff-preview.md). This reference explains the
configuration and release contracts behind those steps.

The staff application serves `staff.lasvegasfortransit.org`. Its protected preview serves
`staff-preview.lasvegasfortransit.org`. The scheduled jobs Worker has no public route. All three
applications, including the public website, use one canonical membership schema; preview uses a
separate database and Discord server.

The staff workflows save compiled applications and migrations, then upload and activate a selected
saved build in preview after maintainer setup. They do not promote staff or jobs to production. The
website's bootstrap and promotion workflows do not provision or promote these applications. Use the
build system and private acceptance record to determine what is deployed and verified. Keep
production provider writes disabled until configuration and live preview acceptance pass.

## Read-only configuration check

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

Newsletter work must also remain disabled during setup. The jobs source configuration must set
`LVBT_BEEHIIV_SYNC_ENABLED=false`; any deployed version with this binding must expose the same
plain-text disabled value. A missing deployed binding does not enable newsletter work. Setup checks
reject newsletter activation both before upload and before activating the saved release. Provider
credentials and live newsletter acceptance belong to the separate launch configuration.

When newsletter synchronization is enabled, a completed roster scan becomes due again 15 minutes
after that scan started. An unfinished scan resumes its saved cursor. Inspect
`beehiiv_poll_checkpoints` privately for `started_at`, `last_completed_at`, page/account counts, and
retry timing; a due scan is not proof that all pages have completed. Delivery observations remain
separate from consent evidence. An observed inactive or paused subscription alone must not supply an
invented withdrawal time.

Saved authenticated source events are applied through the person service in one guarded transaction.
That transaction records the inbox outcome with consent, membership, and engagement changes. It
rechecks current account ownership and prior choices, preserves original source time, and lets
withdrawal win a timestamp tie. A completed outcome clears the saved encrypted address; a case that
needs review retains it for that purpose. Ordinary subscription creation is insufficient evidence to
manufacture consent. An independently confirmed subscription can match or create a person.

Before sending either an activation or removal request, the runner saves minimal attempted-write
evidence. Keep that evidence even if the response is lost or the recovery intent finishes: a later
provider event can be an echo of that request. An event with unclear causation requires review and
cannot reverse a newer member choice. Do not delete attempted-write evidence to make such an event
apply. The provider's original subscription creation time is not a substitute for a change time.

Inspect inbox counts without printing contact or authentication data:

```sql
SELECT state, count(*) AS events FROM newsletter_inbound_events GROUP BY state;
SELECT outcome, reason, count(*) AS events
FROM newsletter_source_operations GROUP BY outcome, reason;
```

These tables require the canonical newsletter migrations. The presence of saved events or passing
local tests does not establish hosted processing. Keep synchronization disabled until the scheduled
incoming dispatcher, staff resolution of review cases, and actual preview-provider acceptance have
all been verified.

## Scheduled newsletter processing

This procedure is for a maintainer preparing newsletter synchronization in the isolated preview.
Complete [staff preview setup](../guides/set-up-staff-preview.md) first. Use an approved test
publication and synthetic members. Enabling synchronization sends real API requests to the selected
publication; an isolated database alone does not protect production subscribers.

LVBT must remain on Beehiiv's Free plan. It supports API access but excludes webhooks and a second
publication in the same workspace. API polling and outgoing account changes do not require a webhook
secret. Use a separate free test account for provider tests; do not upgrade the LVBT plan or use its
production publication to work around this prerequisite. A list observation shows delivery status,
not when someone last changed their consent. Keep processing disabled until status differences,
staff resolution, and actual preview-provider acceptance have been verified.

The website release configuration sets `release.previewOnly=true` in `.lvbt/tooling.json` while
newsletter delivery depends on this unfinished consumer. The shared release commands refuse
production promotion, upload, activation, and saved-release migrations. Preview packaging and
verification remain available. This hold also blocks unrelated website production updates from this
source revision; do not remove it merely to publish another change. Retain the last accepted
production release until newsletter source review, data export/deletion, provider configuration, and
actual preview acceptance are complete. Remove the hold only in a reviewed change that enables and
verifies the consumer before the website begins relying on queued updates.

1. In the separate free test account, select the intended publication and verify API access without
   changing the plan. With the approved key, the subscriptions list must return successfully and
   belong to that test publication. A new account or credential needs maintainer authorization.
   Never use a production subscriber to test write or deletion permissions.
2. Apply the canonical migrations using the preview guide, then verify that the selected database
   contains the newsletter inbox, attempted writes, erasure tables, and
   `0040_newsletter_poll_choices.sql`. All three applications must use this same preview database.
   Do not run a newly built dispatcher against an older schema.
3. Set the jobs preview's public publication variables in `apps/jobs/wrangler.jsonc` before
   building: `LVBT_BEEHIIV_PUBLICATION_ID` identifies the test publication and
   `LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID` identifies production. They must differ in preview. Keep
   `LVBT_BEEHIIV_SYNC_ENABLED=false` during setup. LVBT uses
   `LVBT_BEEHIIV_CONFLICT_POLICY=staff_review`: when an unsubscribe cannot be ordered against a
   recent signup, preserve membership, hold conflicting outgoing subscription changes, and send the
   difference to staff review. Do not change that policy without a new maintainer decision. The
   source default is blank, which disables observation processing. Both policies preserve a verified
   signup made after the observation. Public variables are replaced by uploads; a setting saved only
   in the dashboard does not survive the next release.
4. Using the guide's **Settings → Variables and Secrets** procedure, install the approved API key
   and dedicated `LVBT_NEWSLETTER_INTENT_KEY` on `lvbt-jobs-preview`. The intent key must be a
   base64url-encoded random 32-byte value. Keep it separate from sign-in and provider credentials.
   It protects saved incoming addresses and interrupted outgoing requests. Replacing it while work
   remains encrypted makes those addresses unreadable; drain or explicitly resolve that work before
   a planned rotation. Never print the key or copy production member addresses into preview.
5. Skip callback setup on Free. If signed callbacks become available under a separately approved
   setup, prepare `https://preview.lasvegasfortransit.org/webhooks/beehiiv`. The website's
   `LVBT_DISCORD_JOBS` service binding must target `lvbt-jobs-preview`. The callback accepts only
   JSON POST requests and forwards the original bytes and Svix signature headers privately to jobs;
   jobs has no public route. Beehiiv must reach this callback without an interactive Google login.
   If the preview's Access policy intercepts it, obtain approval for a narrowly scoped callback
   policy before proceeding. The release workflow does not create that exception. Preserve Access
   protection for the rest of the preview and never send preview events to the production callback.
6. For that optional signed setup only, configure the callback in Beehiiv's webhook settings for
   `subscription.created`, `subscription.confirmed`, and `subscription.deleted`. Install its signing
   secret as `LVBT_BEEHIIV_WEBHOOK_SECRET` on jobs preview only. Missing or malformed credentials
   close signed intake without disabling API polling, outgoing changes, or processing of events
   already authenticated and saved. Presence alone does not prove callback reachability or
   publication ownership. See
   [Beehiiv's webhook reference](https://developers.beehiiv.com/webhooks/).
7. Verify that the staff preview's `LVBT_NEWSLETTER_JOBS` service binding points to
   `lvbt-jobs-preview`, and that both use the same isolated database. Production binds to
   `lvbt-jobs`. This binding is separate from the website callback binding. No newsletter API or
   encryption key belongs on staff. Follow the newsletter review procedure below before enabling the
   flag and minute schedule through a reviewed launch release. Keep synchronization disabled until
   actual preview acceptance passes; the setup release deliberately rejects it.
8. During approved live acceptance, use one synthetic member to sign up, unsubscribe, and
   independently confirm a new signup. Check delivery in Beehiiv, the member's resulting status and
   original choice dates in staff, and actual Discord role readback for the linked test account.
   Repeat after a failed request and restart. Where the original choice time is unknown, verify that
   it remains unknown and the agreed conflict rule is followed. Do not count a provider response or
   local fixture as proof of the resulting membership or server permissions.

Saved incoming choices run before outgoing changes. After the roster scan, saved status differences
are processed before outgoing changes, including while Beehiiv requests are paused by a rate limit.
One incoming invocation handles at most three ready changes, and a scheduled tick runs at most six
such batches, followed by at most six observation batches. Each invocation enforces the 50-query
limit. The parent and its loopback calls together stay within 32 invocations, with a call reserved
for completion. Optional work stops after its 50-second dispatch deadline; unfinished work resumes
on the next tick.

The roster scan handles up to five pages of 100 accounts per tick. A 5,000-account roster therefore
needs at least ten successful ticks, and longer during pauses or a slow provider. Check actual queue
age and scan completion during hosted acceptance before relying on that capacity. A roster status
observation does not establish when someone gave or withdrew consent.

A linked inactive status withdraws consent automatically only when a prior active observation or
confirmed active delivery establishes that the signup preceded the unsubscribe interval. Its
effective date is the observation, with the original choice date explicitly unknown. An uncertain
interval follows the configured conflict policy and remains available for staff review. Paused and
undeliverable email statuses do not withdraw membership. Observing an active subscription never
creates or renews permission to email someone.

Inspect ready backlog privately without exposing addresses, encrypted content, or credentials:

```sql
SELECT count(*) AS ready_events, min(received_at) AS oldest_received
FROM newsletter_inbound_events
WHERE state='pending' AND publication_id='pub_APPROVED_PREVIEW'
  AND julianday(occurred_at)<=julianday('now');
```

Replace the placeholder with the selected preview publication ID. A growing oldest-ready age means
processing is not keeping up. Use the aggregate job outcomes and query counts to distinguish a
storage failure from a provider pause. Storage failures leave events pending for retry. Future
source dates wait without holding up other ready events. Unreadable or mismatched addresses and
ambiguous source times require staff review, and hold outgoing changes for the affected account. Do
not clear an error by editing consent, deleting attempted-write evidence, or bypassing ownership
checks. A normal callback for the platform's own subscription creation clears without adding
consent; a possible confirmation or removal echo requires independent evidence. Whole-second
provider times cannot reliably order a competing signup inside the same second.

Run the isolated compiled source-processing fixture with `pnpm -C apps/jobs test:e2e` after building
jobs. It covers signed delivery, membership changes, Discord removal, a complete 5,000-account scan,
rate-limit recovery, restart, and delayed delivery after erasure. It contacts neither live provider.
Use the [deletion procedure](#verify-newsletter-cleanup-after-account-deletion) separately to verify
retention, and keep detailed execution records private.

For individual privacy requests, follow
[Export a member record](../guides/export-a-member-record.md). For deletion logs, daily eligibility
checks, and Google account review, follow
[Operate member data retention](../guides/operate-member-data-retention.md).

## Resolve newsletter follow-up

This procedure is for an LVBT staff administrator checking a difference between the mailing list and
a member record. It works while automatic sending is disabled, once the jobs publication,
credentials, private service binding, and database are configured. Committee leads cannot open these
records or submit decisions.

1. Open **Members → Member records → Newsletter follow-up**. Select **Review preference** beside the
   person. Compare **Mailing list** with **Member record**, then open the member profile if you need
   to check their identity. The noticed date records when the difference was found; it is not a
   claim about when the person changed their mind.
2. If the mailing list says **Unsubscribed**, select **Use mailing list status** to apply that
   status to the member record. This ends membership using the noticed date as an effective date; it
   preserves that the original change date is unknown. There is no extra confirmation form or
   requirement to contact the person again about an unsubscribe already recorded by the list.
3. If the screen offers **Keep newer signup**, a later signup and verified email are already
   recorded. Select it to clear the older difference and queue that preference. This action never
   creates consent. A known newer signup cannot be overridden by an older list observation. If the
   person wants to rejoin and no new signup is recorded, open **If they want to rejoin** and share
   the linked LVBT signup form. Reload **Check for a new signup** afterward.
4. If there is **No matching record**, check the displayed email and use **Find member record**. An
   API observation alone cannot create membership. Complete the normal signup or approved
   roster-import procedure, then reload the follow-up. Do not attach an account by editing database
   IDs, fabricate an old signup, or remove an unresolved review merely to unblock sending.
5. Confirm **Preference recorded** and that the item leaves the list. A record that changes while
   the form is open requires a reload. Duplicate submissions cannot apply another choice. A storage
   or audit failure leaves the choice unapplied; retry from a freshly loaded form. An unavailable
   screen requires checking the jobs binding, publication configuration, and API access before
   retrying. Keep technical diagnostics in private operator records.

After building both staff and jobs, run
`pnpm -C apps/staff exec node --import tsx tests/e2e/newsletter-review.spec.ts` for isolated browser
acceptance. It exercises the real private service binding, administrator permissions, an actual form
submission with JavaScript disabled, an unmatched address lookup, and mobile/dark layouts. It does
not establish hosted acceptance or permission to run tests against real subscribers.

## Verify newsletter cleanup after account deletion

This procedure is for a maintainer testing deletion in the isolated preview. It checks that queued
newsletter addresses are cleared, the subscriber is removed from Beehiiv, and delayed newsletter
messages cannot recreate a removed member. An ordinary newsletter unsubscribe keeps the Beehiiv
subscriber inactive. Permanent account deletion also deletes that subscriber and its associated
provider data; a reversible duplicate archive does not authorize this permanent deletion.

Before you start, you need an approved preview test member separate from the preview administrator,
access to the selected preview database, and the database checks in
[Set up the protected staff preview](../guides/set-up-staff-preview.md). Use the separate test
publication with approved API credentials. Signed callback checks apply only when that optional
capability is configured; API polling works on Free. Keep newsletter writes disabled while preparing
the release and applying its canonical migrations.

1. Check the selected database's migration list for both erasure migrations. The following read-only
   query must return two rows. A missing row means the database needs the release's migrations
   before you test or enable the new application.

   ```sql
   SELECT name FROM d1_migrations
   WHERE name IN ('0038_newsletter_erasure.sql','0039_newsletter_erasure_cleanup.sql');
   ```

2. Complete the scheduled newsletter setup above. Confirm that the separate test member is
   subscribed in the test publication, then sign in as that member and use `/account/delete/` to
   request deletion. Complete the confirmation in that test member's own inbox. The account must be
   signed out and its profile cleared. Do not delete the preview administrator or another person's
   record for this test.

3. Allow the scheduled job to finish. Privately inspect that test person's `newsletter_sync_jobs`
   row: `state='done'` means its current targets were confirmed. In the test publication, the
   subscriber must be absent, rather than merely unsubscribed. The adapter sends an unsubscribe
   first, then the
   [permanent deletion request](https://developers.beehiiv.com/api-reference/subscriptions/delete),
   and requires a separate subscriber lookup to return not found. An accepted deletion response
   alone is insufficient. Do not use another subscriber or the production publication to test this.

4. Inspect these aggregate counts privately. Both must be zero. They check saved addresses for
   removed connected accounts and temporary deletion checks without printing contact details.

   ```sql
   SELECT count(*) AS retained_addresses
   FROM newsletter_inbound_events e
   JOIN identities i ON i.platform='beehiiv' AND i.external_id=e.subscription_id
   JOIN person_keys k ON k.id=i.person_id
   WHERE k.erased_at IS NOT NULL AND e.encrypted_email IS NOT NULL;
   SELECT count(*) AS unfinished_checks FROM newsletter_erasure_checks;
   ```

5. From a configured local checkout, run the regression checks for queued addresses, delayed
   messages, merged accounts, fresh signups, rollback and the worker's query limit:

   ```sh
   pnpm --filter @lasvegasfortransit/platform-storage exec node --import tsx --test tests/newsletter-erasure.test.ts tests/newsletter-erasure-races.test.ts tests/maintenance-budget.test.ts
   pnpm --filter @lasvegasfortransit/platform-integrations exec node --import tsx --test tests/beehiiv-erasure.test.ts
   pnpm -C apps/jobs build
   pnpm -C apps/jobs test:e2e
   ```

   All checks must pass. These checks exercise the canonical schema locally; they do not establish
   that a hosted provider has deleted its subscriber. Verify that separate outcome during live
   provider acceptance.

Deletion covers the current combination of member records and their connected newsletter addresses.
It clears queued or review addresses in the same transaction as the profile. If ownership changes
during preparation, deletion retries from the current records up to three times. A later failure
rolls back the entire change. Retry through the normal deletion flow after concurrent edits finish;
do not bypass the checks or manually clear their tables.

`newsletter_address_tombstones` keeps an address fingerprint and deletion time, without the address
or member's name, so an older message cannot create another profile. Keep these fingerprints when
purging the profile. A newer message with unclear ownership remains for review. A fresh verified
website signup can create a new member record and honor later unsubscribes; it cannot restore the
erased record. The staff workflow for resolving ambiguous newsletter changes must be verified before
enabling synchronization.

Pending outgoing cleanup can still need an encrypted address until Beehiiv's stable subscriber ID is
known. Keep that recovery work until remote removal is confirmed. Migration
`0039_newsletter_erasure_cleanup.sql` requeues erased accounts whose earlier job confirmed only an
unsubscribe. Historical receipts retain the subscriber ID needed to finish that cleanup, including
when an interrupted signup never attached an identity. Only receipts from the selected publication
are considered, and current ownership is checked before changing the subscriber.

If deletion fails, leave the job pending. A rate limit pauses provider calls until its retry time;
an unavailable provider or an unconfirmed deletion retries. Denied permissions require maintainer
review of the approved key and publication before retrying through the normal runner. If the
provider removed a subscriber but its response was lost, the next lookup can confirm absence. Do not
mark the job done manually or delete recovery intents, historical receipts, or connected IDs to
clear an error. Clearing the local profile or incoming queue does not establish provider removal.
During physical retention, connected profile copies are removed with the authorized profile
deletion; the entire maintenance transaction still fits the worker's 50-query limit.

## Maintainer setup

Use the existing values and approved applications in the
[Worker runtime configuration](../../packages/platform-integrations/src/worker-runtime-config.ts),
following [platform secrets](./platform-secrets.md). Agents must not set or rotate production
credentials.

1. Confirm the selected Cloudflare account and database. Production uses `lvbt-platform`; preview
   uses `lvbt-platform-preview`. Site, staff and jobs must bind the same database within each
   environment and use `packages/platform-storage/migrations`.
2. Create the dedicated `console-users@lasvegasfortransit.org` Workspace group. Admit only approved
   team members who are already LVBT members. Group entry grants no administrator permissions.
3. Protect each exact staff hostname with its own Access application and matching audience. Set
   application and policy sessions to 12 hours. Allow the Console users Google group and require the
   LVBT email domain. Do not add bypass policies or broader alternative allow rules. Review the
   Google identity provider and actual group membership separately.
4. Register the fixed staff and staff-preview Google callback addresses documented in
   [Google sign-in setup](./platform-secrets.md#google-sign-in-for-the-website). Keep dynamic
   preview origins disabled unless explicitly approved. Configure the existing sign-in and email
   bindings on staff. The sign-in signing secret must match the shared session storage; an existing
   secret name does not prove its value matches. Confirm a real sign-in before acceptance.
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
   requests recover through the same scheduled work. Apply the canonical disconnect-intent migration
   before publishing these controls.
7. Before the first administrator signs in, set the secret
   `LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL` on the selected staff Worker to the president's exact
   `@lasvegasfortransit.org` account. On `lvbt-staff-preview`, use an approved Google account linked
   to a clearly marked test member in the isolated preview database. This may be an existing staff
   Google account; do not copy production member records or permissions. Do not store this value in
   source control or use a personal email. The one-time setup page checks that this exact Workspace
   account is linked to an active LVBT member and that no administrator designation exists, then
   records the grant in the staff audit log. Once deployed, the first sign-in goes to that page
   automatically; the president completes the setup and verifies access. Remove the temporary secret
   after the audited designation is confirmed. Do not infer admin access from a domain or group
   alone.

## Release order and rollback

### Prepare the saved artifact

The **Build staff release** workflow validates a main-branch source commit, runs the compiled local
runtime suites, builds staff and jobs, and saves `staff-release-<Actions run ID>`. It has no
deployment credentials and does not upload Worker versions or apply migrations. CI also checks
packaging on pull requests.

For a maintainer preparing a release locally, select a clean source checkout and an unused directory
outside it:

```sh
pnpm staff:release package --directory /tmp/staff-release --commit <full-source-commit> --release-id <Actions-run-ID>
pnpm staff:release check --directory /tmp/staff-release --commit <full-source-commit> --release-id <Actions-run-ID>
```

`package` refuses tracked or untracked source changes, checks the selected commit before and after
building, and saves the compiled staff modules, protected assets, jobs Worker, complete SQL
migration sequence and portable preview/production configurations. It omits local paths in generated
build configuration and jobs source maps. The staff build uses portable source locations in compiled
Astro metadata. Release variables are restricted to approved public configuration; provider
credentials belong in secret bindings. The manifest identifies the source commit and hashes every
file and migration. Reusing a destination fails instead of replacing a reviewed artifact.

`verify` checks the selected source identity and exact saved contents. `check` additionally runs all
four configurations through Wrangler's local version-upload dry run with bundling disabled. It uses
a temporary working copy so CLI cache files cannot change the saved artifact. Neither command
deploys code, changes schedules or applies SQL. A successful check proves packaging, not provider
configuration or hosted acceptance. Hashes detect changes; selection of a trusted successful Actions
run and artifact is still required for deployment provenance.

The **Prepare staff release** workflow accepts a successful **Build staff release** run ID. It
retrieves that exact run's artifact, checks repository and main-branch workflow provenance, verifies
the archive against GitHub's SHA-256 digest, and then checks the internal manifest and compiled
runtime. It has no deployment credentials. It does not rebuild, activate Workers or apply SQL.

A maintainer can perform the same retrieval with an existing GitHub CLI login:

```sh
pnpm staff:release prepare --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release
```

Use a new directory. Failed or unfinished runs, fork builds, expired or ambiguous artifacts, digest
mismatches and unsafe archive paths are refused. The command reports the source commit, run ID,
artifact ID and hashes without printing provider output. A successful preparation verifies the saved
build; protected preview deployment and human/provider acceptance are still required.

The manifest contains file hashes. The **Deploy staff preview** workflow uploads those saved files
and saves the actual staff and jobs version IDs in a separate deployment receipt. It verifies each
uploaded version's source annotation, database and bindings before activating either version, then
requires provider readback showing those exact versions at 100 percent. It never rebuilds, applies
SQL, changes secrets, creates Workers or changes routes and schedules.

Before using the workflow, a maintainer must create the `staff-preview` GitHub environment with
required reviewers and main-only deployment protection. Set its `CLOUDFLARE_ACCOUNT_ID` variable and
scoped `CLOUDFLARE_STAFF_PREVIEW_API_TOKEN` secret. Referencing an environment in YAML does not
create its review protections. Complete the existing Worker, Access, database migration and domain
setup first. The workflow's default **launch** stage additionally requires schedule and provider
configuration. Choose **setup** for the initial protected preview with Discord disabled and no cron
triggers. This lets staff test sign-in and workflows before provider activation. It cannot enable
Discord, run background jobs, or deploy production. Cloudflare version uploads require an existing
Worker; a failed upload does not fall back to a first deployment.

A maintainer with a clean checkout of the verified build's commit can run the same two steps:

```sh
pnpm staff:release upload --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target preview --receipt /tmp/staff-deployment.json
pnpm staff:release activate --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target preview --receipt /tmp/staff-deployment.json
```

For initial setup, add `--stage setup` to both commands. The deployment receipt records the stage; a
setup receipt cannot be resumed as a launch deployment. Omitting the option retains the full launch
gate. Resolve the remaining configuration and live-provider acceptance before enabling schedules or
treating a setup preview as operational.

Both commands require explicit scoped `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
credentials. They recheck the successful main build's GitHub artifact and reject a changed checkout
or saved artifact. Keep the receipt outside the artifact. Upload refuses an existing receipt. If
either step fails, retain its receipt and inspect provider state before retrying; an error can
follow a provider write. Activation with the same receipt skips versions already confirmed active,
preserves partial results, and refuses to overwrite a conflicting deployment after an acknowledged
activation. A configuration change can temporarily leave staff and jobs on different Discord
settings: resuming requires each active version to be either the recorded previous version or the
selected new version, with independently valid settings for the selected environment. Unexpected
versions and other configuration failures still stop activation. The workflow retains this receipt
even on failure. Configuration checks do not prove sign-in, live provider behavior or staff
acceptance. Production promotion remains unfinished and is not available through these commands.

### Recover a failed preview activation

Use this procedure if **Deploy staff preview** fails during upload or activation. An error does not
establish whether Cloudflare changed traffic. Do not rerun the whole workflow to find out.

1. Open the failed Actions run. Download its `staff-preview-deployment-<run ID>` artifact and keep
   `staff-deployment.json` in an approved private location. If no receipt exists, inspect the upload
   step and actual provider state; do not invent a receipt or assume no version was created.
   Activation requires a complete receipt containing both staff and jobs uploaded versions. A
   partial upload with only one recorded version cannot use the activation command. Preserve that
   receipt and the actual provider state; completing a partial upload needs a separately reviewed
   recovery path. Do not edit the receipt to supply a guessed version.
2. In Cloudflare, select the LVBT account, then **Workers & Pages → lvbt-staff-preview →
   Deployments**. Compare the currently served version and traffic percentage with the receipt's
   selected version and recorded previous versions. Repeat for `lvbt-jobs-preview`. A version marked
   **Ready** with no traffic is uploaded, not active.
3. In GitHub **Actions → Recover staff preview → Run workflow**, choose `main`. Enter the original
   successful build's run ID as **release_run**, the completed deployment run holding its receipt as
   **deployment_run**, and the receipt's exact **stage**. Leave **operation** set to **inspect**.
4. Review the selected release and approve the existing protected `staff-preview` environment.
   Inspection verifies the archive, receipt, clean selected source, uploaded versions,
   configuration, and actual traffic. It sends no upload or activation command and does not change
   the receipt. Its report says `ready: true` only when the activation gates pass. A blocked
   inspection exits with failure and identifies the failed stage or configuration checks. Repair the
   specific cause through its authorized procedure; keep an unknown failure unresolved.
5. Once inspection passes, run **Recover staff preview** with the same selections and **operation =
   resume**. Review and approve that protected run. It rechecks the gates and activates only the
   recorded versions, preserving completed activation and refusing unexpected traffic. It never
   rebuilds or uploads. A completed recovery run retains its receipt under
   `staff-preview-deployment-<recovery run ID>`; that run can be selected for a later inspection or
   resumption if needed.
6. Check both active deployments again, run the matching preflight, and open the protected staff
   hostname. Record activation and sign-in outcomes separately in the private acceptance record.

Recovery uses the same scoped deployment credential and serialized deployment queue as the normal
preview workflow. Do not extract GitHub secrets, copy browser sessions, or create a broader key to
run recovery locally. Inspect and resume are separate choices; selecting inspect cannot activate a
version. Neither choice can deploy production, apply migrations, or enable schedules.

### Inspect with an approved local credential

Use the GitHub procedure above when the credential is installed only there. A maintainer with an
already authorized local credential can prepare the original build and retrieve its receipt:

```sh
pnpm staff:release receipt --directory /private/selected-staff-release --repository LasVegasForTransit/website --run-id <build-run-ID> --deployment-run <deployment-run-ID> --target preview --stage setup --receipt /private/staff-deployment.json
pnpm staff:release inspect --directory /private/selected-staff-release --repository LasVegasForTransit/website --run-id <build-run-ID> --target preview --stage setup --receipt /private/staff-deployment.json --source-directory /private/selected-staff-source
```

Replace paths and IDs with the reviewed selections. Prepare the artifact with
`staff:release prepare` first, and check out its exact source commit cleanly in
`/private/selected-staff-source`. The current trusted verifier runs recovery; the separate source
checkout pins the original configuration. Omit `--source-directory` only when the verifier checkout
itself is the selected source. Receipt retrieval needs the explicit account ID and GitHub read
access; it does not use a Cloudflare token. Inspection and activation also require the approved
scoped Cloudflare token. For a launch-stage receipt, use `--stage launch` consistently.

Receipt retrieval accepts only a completed main-branch deployment or recovery workflow in this
repository, exactly one unexpired receipt artifact, its verified archive digest, and both uploaded
versions matching the selected build, account, environment, and stage. It refuses existing output
files. Malformed, missing, partial, foreign, or changed receipts cannot authorize activation.

| Failure stage                              | Meaning and next action                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `saved-build` or `saved-artifact`          | Verify the original successful build and retained artifact; do not substitute a newer build.                      |
| `source-checkout` or `saved-configuration` | Restore a clean checkout of that build's source and compare its saved configuration.                              |
| `receipt`                                  | Verify the selected deployment run, complete receipt, account, and stage. Do not edit or guess recorded versions. |
| `staff.version` or `jobs.version`          | The uploaded version could not be verified against the saved release; inspect its metadata before any activation. |
| `configuration` or `setup-boundary`        | Read the named configuration checks and confirm setup keeps Discord disabled and jobs unscheduled.                |
| `recorded-traffic`                         | Actual traffic differs from an allowed recorded transition or cannot be verified; investigate the provider state. |
| A Worker `activation` or `readback` stage  | A deployment may have changed traffic; inspect both actual deployments and the retained receipt before resuming.  |

### Activate and verify

A release must record the source commit, canonical migration names, staff and jobs version IDs,
Access hostnames and acceptance evidence. Build and review all applications from that same source.
Do not rebuild a different artifact while promoting a reviewed release. Public website promotion
remains separate.

Before applying migrations, a maintainer
[takes and verifies a database backup](../guides/back-up-membership-database.md) and reviews the
canonical upgrade against the current deployed schema. Apply migrations before activating code that
requires them. Keep scheduled jobs inactive while the applications and bindings are being updated.
Verify the protected preview first, including refusal on alternate hosts and direct asset requests.
Enable schedules and provider writes only after real preview grant, readback, retry and revocation
evidence exists.

Rehearse pending migrations from the retained schema, including the migration-tracking inserts:

```sh
pnpm -C apps/site exec node --import tsx --test tests/d1-migration-compatibility.test.ts
```

Wrangler sends each remote migration and its tracking insert as one SQL string to D1's query API.
Its local splitter and ordinary SQLite can accept SQL that the remote parser rejects. Keep
`CASE … END` expressions inside trigger bodies parenthesized; a bare expression can be mistaken for
the end of the trigger. The compatibility regression checks every migration after 33 and exercises
its upgrade from schema 33 with retained administrators and newsletter activity. A local rehearsal
is not proof of a remote apply. If an apply fails, stop and read the migration tracker and expected
schema objects before retrying; earlier successful migrations remain applied. Correct only pending
migrations, and preserve data and SQL behavior. See
[Cloudflare's trigger parser issue](https://github.com/cloudflare/workers-sdk/issues/4727) and
[migration rollback behavior](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply).

Rollback changes application versions; it must preserve accepted consents, assignments, welcome
claims, events and provider cleanup work. Do not reverse migrations or restore an old database over
new staff activity. Validate any rollback version against the current schema before activation.

## Google committee access

The Google Directory adapter reconciles verified linked accounts against current and retained
committee group mappings. Each group has a separate, five-minute readback checkpoint so interrupted
work can resume. The account receipt is saved only after every group in the current plan is
confirmed, and expires with the earliest group proof. Future-dated checkpoints cannot confirm
current access. It does not complete Discord or mailing-list work. Migration 0026 preserves existing
Discord audit intents and adds Google intents and group checkpoints; a maintainer must review and
apply it with the other canonical migrations before running this code against hosted data.

Grants require the exact linked user ID, primary email and Workspace customer. Suspended, archived,
renamed or mismatched accounts are refused. Existing owners and managers keep their role while
assigned; withdrawal removes the selected direct membership regardless of role. Removal uses the
stable user ID and can continue after personal email has been erased. The adapter also checks
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
when setup is unavailable. Real preview grant, readback, revocation and retry evidence remains
required before production use.

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

## Historical roster preview

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
consent provenance, and duplicate resolution before any import is separately authorized. This
preview command has no apply option.

## Verification still required

Run `pnpm check`, then the compiled runtime suites sequentially after the build has finished:

```sh
pnpm -C apps/jobs test:maintenance
pnpm -C apps/jobs test:e2e
pnpm -C apps/staff test:e2e
pnpm -C apps/staff test:release
pnpm -C apps/site test:account-data:lighthouse
```

The account-data fixture covers authenticated download and deletion, including JavaScript-disabled
forms; its accessibility and Lighthouse checks use local fixtures only.

These use synthetic data and isolated providers. They cannot prove real Google sign-in, a complete
imported roster, Discord server operation, Google Group or mailing-list synchronization, production
deployment, or staff usability. Record real administrator, committee-lead and refused-account
outcomes, provider readback and recovery, three staff sessions including assistive technology, and
the agreed week of production use before declaring launch complete. Keep member contact data and
private task tracking out of public release evidence.
