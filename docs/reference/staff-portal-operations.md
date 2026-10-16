# Staff portal setup and release

For the complete first-time procedure, use
[Set up the protected staff preview](../guides/set-up-staff-preview.md). This reference explains the
configuration and release contracts behind those steps.

The staff application serves `staff.lasvegasfortransit.org`. Its protected preview serves
`staff-preview.lasvegasfortransit.org`. The scheduled jobs Worker has no public route. All three
applications, including the public website, use one canonical membership schema; preview uses a
separate database and Discord server.

The staff workflows save compiled applications and migrations, then upload and activate a selected
saved build in preview after maintainer setup. The separate protected production workflow uses the
same saved release after launch approval and removal of the production hold. The website's bootstrap
and promotion workflows do not provision or promote these applications. Use the build system and
private acceptance record to determine what is deployed and verified. Keep automatic production
provider writes disabled until configuration and live acceptance pass.

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
incoming dispatcher, staff resolution of review cases, and approved live provider acceptance have
all been verified.

## Scheduled newsletter processing

This procedure is for a maintainer preparing newsletter synchronization. Keep Beehiiv on Free and
use **LVBT Updates** as the only publication. Free supports API access; scheduled polling and
outgoing subscription changes do not require webhooks or another account. A list observation shows
delivery status, not when someone last changed their consent.

Before you start, complete [staff preview setup](../guides/set-up-staff-preview.md) and use local
fixtures for ordinary preview testing. Keep `LVBT_BEEHIIV_SYNC_ENABLED=false` on both hosted
previews and production during setup. The preview runtime rejects the production publication;
preserve that guard and keep live Beehiiv credentials out of preview. An isolated database alone
cannot protect the real mailing list.

The website release configuration sets `release.previewOnly=true` in `.lvbt/tooling.json` while
newsletter delivery depends on this unfinished consumer. The shared release commands refuse
production promotion, upload, activation, and saved-release migrations. Preview packaging and
verification remain available. This hold also blocks unrelated website production updates from this
source revision; do not remove it merely to publish another change. Retain the last accepted
production release until newsletter source review, data export/deletion, provider configuration, and
actual workflow and provider acceptance are complete. Remove the hold only in a reviewed change that
enables and verifies the consumer before the website begins relying on queued updates.

1. Apply the canonical migrations using the preview guide, then verify that the selected database
   contains the newsletter inbox, attempted writes, erasure tables, and
   `0040_newsletter_poll_choices.sql`. All three applications must use this same preview database.
   Do not run a newly built dispatcher against an older schema.
2. Build jobs, then run `pnpm -C apps/jobs test:e2e`. These isolated fixtures use synthetic
   publication IDs, fake credentials and a local provider substitute. They exercise scheduled
   processing without contacting Beehiiv or Discord. Follow the newsletter review and deletion
   procedures below for the remaining local workflow checks. Do not replace fixture IDs or keys with
   live values.
3. Preserve `LVBT_BEEHIIV_CONFLICT_POLICY=staff_review` in the reviewed launch configuration: when
   an unsubscribe cannot be ordered against a recent signup, preserve membership, hold conflicting
   outgoing subscription changes, and send the difference to staff review. Do not change that policy
   without a new maintainer decision. A blank policy disables observation processing. Always
   preserve a verified signup made after the observation.
4. Obtain separate approval before creating a production platform API key or installing it as
   `LVBT_BEEHIIV_API_KEY` on **`lvbt-jobs` only**. Do not rotate or reuse an unrelated integration's
   key. In Beehiiv's new-key form, select **LVBT Updates** under **Publications**; do not leave
   **All publications** selected. The key permits API access across the selected publication, rather
   than restricting writes to the test address. The
   [one-address provider rehearsal](#rehearse-beehiiv-with-one-approved-address) below needs its own
   explicit approval for test writes and permanent cleanup; key approval does not grant those
   actions or enable synchronization.
5. Prepare the production public variables in `apps/jobs/wrangler.jsonc` through a reviewed release.
   `LVBT_BEEHIIV_PUBLICATION_ID` and `LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID` must both identify
   **LVBT Updates** in production. Preview must never select that publication. Public variables are
   replaced by uploads; a setting saved only in the dashboard does not survive the next release.
6. Install a dedicated `LVBT_NEWSLETTER_INTENT_KEY` on the selected jobs Worker using the guide's
   **Settings → Variables and Secrets** procedure. It must be a base64url-encoded random 32-byte
   value, separate from sign-in and provider credentials. It protects saved incoming addresses and
   interrupted outgoing requests. Replacing it while work remains encrypted makes those addresses
   unreadable; drain or explicitly resolve that work before a planned rotation. Never print the key
   or copy production member addresses into preview. No newsletter API or encryption key belongs on
   staff.
7. Verify the staff preview's `LVBT_NEWSLETTER_JOBS` service binding targets `lvbt-jobs-preview` and
   the same isolated database. Production staff targets `lvbt-jobs`. This differs from the website's
   `LVBT_DISCORD_JOBS` binding used to forward optional callbacks. Keep the flag and minute schedule
   disabled until a reviewed launch release passes the required workflow and live acceptance.

Production publication and schedule activation use the
[protected saved-release procedure](#publish-an-approved-staff-production-release) below. The
production hold still blocks uploads, activation and schedule writes. Keep schedules and
synchronization disabled until the separately reviewed launch change and acceptance are complete.

Once launch is approved, set `LVBT_BEEHIIV_SYNC_ENABLED=true` and `triggers.crons` to
`["* * * * *"]` for only the approved target environment in `apps/jobs/wrangler.jsonc`. Production
uses the top-level settings; a named environment uses its own `env` entry. Update that environment's
disabled-state expectations in `apps/jobs/tests/configuration.test.ts`, regenerate Worker types, and
run `pnpm check`. The reviewed release path must apply and read back the approved schedule as well
as activate the saved code; version activation alone does not change cron triggers. Verify actual
scheduled processing before accepting launch. Dashboard-only cron edits do not survive later
uploads. Leave other environments disabled and retain the `release.previewOnly` hold until its
separate removal requirements above are met.

Skip webhook configuration on Free. If signed callbacks become available under a separately approved
setup, configure `subscription.created`, `subscription.confirmed`, and `subscription.deleted`, with
`LVBT_BEEHIIV_WEBHOOK_SECRET` on the matching jobs Worker. The existing website `/webhooks/beehiiv`
route forwards the original JSON bytes and Svix signature headers through its private jobs binding;
jobs has no public route. Verify publication ownership and reachability. An Access exception, if
required, needs separate approval and must preserve protection elsewhere. Do not route production
events to preview or bypass the preview publication guard. Missing or malformed signing credentials
close signed intake without disabling API polling, outgoing changes, or events already authenticated
and saved. See [Beehiiv's webhook reference](https://developers.beehiiv.com/webhooks/).

### Rehearse Beehiiv with one approved address

This is a bounded, one-use operator API procedure against **LVBT Updates**, separate from the
ordinary preview runtime. The application has no live test mode or single-address test endpoint.
Keep hosted synchronization disabled throughout. API readback proves only these provider operations;
it does not prove the scheduled consumer, member signup, staff review, deletion flow or Discord
permissions work end to end. Those remain launch acceptance requirements.

Before you start, obtain explicit authorization for the new production platform key, its `lvbt-jobs`
destination, and the exact test address and create/unsubscribe/delete operations. Use a new
plus-address whose inbox the approving operator controls, represented here as
`operator+APPROVED-TEST@example.invalid`. Replace this placeholder only in private execution inputs.
Do not use an existing subscriber, even if it belongs to the operator. Approval for an API key alone
does not authorize test writes or deletion.

Use an approved local API client with the key loaded privately, an eight-second request timeout,
redirects disabled, and automatic retries disabled. Never place the key in command arguments, public
logs or tracked files. Set the request base to
`https://api.beehiiv.com/v2/publications/pub_APPROVED_LVBT_UPDATES`; confirm the publication ID in
Beehiiv and replace `pub_APPROVED_LVBT_UPDATES` before sending anything. Review the client's exact
requests and enforce a fixed publication, one exact address, at most one create, one unsubscribe and
one delete. The current application adapter is not a one-address operator harness; do not run the
general synchronizer for this check.

1. Read `GET /subscriptions?limit=1` and `GET /custom_fields`. Both must return HTTP 200 with the
   expected publication's subscription and custom-field data. An empty custom-field list is valid.
   Do not create or change fields. A 401 or 403 means the key lacks access; stop and review
   authorization. A failure is not a reason to upgrade the plan. See the
   [subscriptions](https://developers.beehiiv.com/api-reference/subscriptions/index) and
   [custom fields](https://developers.beehiiv.com/api-reference/custom-fields/index) references.
2. Look up the exact approved address with
   `GET /subscriptions/by_email/{URL-encoded-approved-address}`. Encode the plus sign as `%2B` and
   `@` as `%40`; do not strip the plus suffix. Require HTTP 404 before any create. If a record is
   returned, stop without writing and choose a different address through the same approval process.
   An error, timeout or invalid response does not prove absence. See
   [Get subscription by email](https://developers.beehiiv.com/api-reference/subscriptions/get-by-email).
3. Privately record the approved address and attempt time before writing. Immediately repeat the
   absence check, then send one `POST /subscriptions` with the approved address,
   `reactivate_existing:false`, `send_welcome_email:false`, `double_opt_override:"off"`, and
   `utm_source:"lvbt_operator_acceptance"`. Add no automations or custom fields. Privately save the
   returned subscriber ID. Read by both ID and exact address; require matching ID/address and
   `status:"active"`. Stop on a mismatched identity, unexpected status or uncertain create outcome.
   See [Create subscription](https://developers.beehiiv.com/api-reference/subscriptions/create).
4. Before unsubscribing, read the saved ID and the address again. Both must identify the same newly
   created test subscription with `status:"active"`. Send one `PATCH /subscriptions/{saved-id}` with
   `{"unsubscribe":true}`. Read it again and require `status:"inactive"` with the same ID/address.
   Do not update an email, reactivate an account, or select a replacement ID. See
   [Update subscription](https://developers.beehiiv.com/api-reference/subscriptions/patch).
5. Before permanent cleanup, repeat both identity checks against the saved ID/address and require
   `status:"inactive"`. Send one `DELETE /subscriptions/{saved-id}` under the explicit deletion
   approval, then require HTTP 404 from separate ID and address lookups. A successful write response
   alone does not prove cleanup. See
   [Delete subscription](https://developers.beehiiv.com/api-reference/subscriptions/delete).
6. Keep only the needed outcome and recovery details in a private operational record, with an owner
   and deletion date. Remove temporary credential material and revoke an approved temporary key. A
   retained production key belongs only on `lvbt-jobs`. Leave synchronization disabled; completing
   this rehearsal does not authorize a production release or remove the deployment hold.

After a timeout, lost response, rate limit or server error, stop writes and resolve the outcome with
read-only lookups. Respect `Retry-After` before another read; limit recovery to three lookups per
failed step. Never retry a create automatically. If its ID was lost, recover it only from the exact
approved address and compare it with the private attempt record before requesting further action. If
identity or cleanup cannot be confirmed, record the unresolved test subscription privately and
escalate for authorization; do not guess, delete another record or repeat the write blindly.

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
WHERE state='pending' AND publication_id='pub_SELECTED_PUBLICATION'
  AND julianday(occurred_at)<=julianday('now');
```

Replace the placeholder with the selected environment's publication ID; local fixtures use their
synthetic ID, and accepted production uses LVBT Updates. A growing oldest-ready age means processing
is not keeping up. Use the aggregate job outcomes and query counts to distinguish a storage failure
from a provider pause. Storage failures leave events pending for retry. Future source dates wait
without holding up other ready events. Unreadable or mismatched addresses and ambiguous source times
require staff review, and hold outgoing changes for the affected account. Do not clear an error by
editing consent, deleting attempted-write evidence, or bypassing ownership checks. A normal callback
for the platform's own subscription creation clears without adding consent; a possible confirmation
or removal echo requires independent evidence. Whole-second provider times cannot reliably order a
competing signup inside the same second.

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

This procedure is for a maintainer verifying account-deletion cleanup. Local fixtures check that
queued newsletter addresses are cleared, the subscriber is removed from Beehiiv, and delayed
newsletter messages cannot recreate a removed member. An ordinary newsletter unsubscribe keeps the
Beehiiv subscriber inactive. Permanent account deletion also deletes that subscriber and its
associated provider data; a reversible duplicate archive does not authorize this permanent deletion.

Before you start, complete the database checks in
[Set up the protected staff preview](../guides/set-up-staff-preview.md). Use isolated local fixtures
with synthetic members and provider responses for ordinary acceptance. Keep hosted newsletter writes
disabled while preparing the release and applying migrations. Do not put a live key into preview or
change its publication guard. The
[one-address provider rehearsal](#rehearse-beehiiv-with-one-approved-address) separately verifies
Beehiiv removal; it does not verify the application's account-deletion flow against a live provider.
Signed callback checks apply only when that optional capability is configured; API polling works on
Free.

1. Check the selected database's migration list for both erasure migrations. The following read-only
   query must return two rows. A missing row means the database needs the release's migrations
   before you test or enable the new application.

   ```sql
   SELECT name FROM d1_migrations
   WHERE name IN ('0038_newsletter_erasure.sql','0039_newsletter_erasure_cleanup.sql');
   ```

2. From a configured local checkout, run the regression checks for queued addresses, delayed
   messages, merged accounts, fresh signups, rollback and the worker's query limit:

   ```sh
   pnpm --filter @lasvegasfortransit/platform-storage exec node --import tsx --test tests/newsletter-erasure.test.ts tests/newsletter-erasure-races.test.ts tests/maintenance-budget.test.ts
   pnpm --filter @lasvegasfortransit/platform-integrations exec node --import tsx --test tests/beehiiv-erasure.test.ts
   pnpm -C apps/jobs build
   pnpm -C apps/jobs test:e2e
   ```

   All checks must pass. The compiled jobs fixture substitutes Beehiiv responses and verifies
   deletion of synthetic accounts, including saved newsletter addresses and delayed events. The
   separate account workflow must verify `/account/delete/`, inbox confirmation, sign-out and
   profile clearing with an approved synthetic member. Never delete the preview administrator or
   another person's record for a test.

3. In the isolated fixture, a completed test person's `newsletter_sync_jobs` row has `state='done'`;
   its current cleanup targets were confirmed. The provider substitute must report the subscriber
   absent, rather than merely unsubscribed. The adapter sends an unsubscribe first, then the
   [permanent deletion request](https://developers.beehiiv.com/api-reference/subscriptions/delete),
   and requires a separate subscriber lookup to return not found. An accepted deletion response
   alone is insufficient. Hosted end-to-end deletion remains unverified until a separately approved
   launch acceptance plan uses a new, explicitly approved test identity and confirms all these
   outcomes. Do not run the unrestricted production consumer as a single-address rehearsal.

4. When inspecting a retained acceptance database after an authorized deletion, run these aggregate
   counts privately. Both must be zero. They check saved addresses for removed connected accounts
   and temporary deletion checks without printing contact details. Local fixtures use temporary
   databases and perform their own assertions before cleanup.

   ```sql
   SELECT count(*) AS retained_addresses
   FROM newsletter_inbound_events e
   JOIN identities i ON i.platform='beehiiv' AND i.external_id=e.subscription_id
   JOIN person_keys k ON k.id=i.person_id
   WHERE k.erased_at IS NOT NULL AND e.encrypted_email IS NOT NULL;
   SELECT count(*) AS unfinished_checks FROM newsletter_erasure_checks;
   ```

These checks exercise the canonical schema locally; they do not establish that a hosted provider has
deleted its subscriber. Verify that separate outcome during approved live provider acceptance.

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

### Prepare the isolated Discord preview

This procedure lets a maintainer prepare the test server without enabling Discord account linking or
background role changes. Before starting, complete the approved app, test-server, bot-permission and
credential setup in [platform secrets](./platform-secrets.md#discord). The bot must be above the
test Member role. Keep the bot token only on `lvbt-jobs-preview` and the OAuth client secret only on
`lvbt-website-preview`; do not copy either value into source or release credentials.

1. In the `env.preview.vars` sections of `apps/jobs/wrangler.jsonc` and `apps/staff/wrangler.jsonc`,
   use the same approved public values:

   | Setting                            | Preview value         |
   | ---------------------------------- | --------------------- |
   | `LVBT_DEPLOYMENT_ENV`              | `preview`             |
   | `LVBT_DISCORD_APPLICATION_ID`      | `1552481672945999872` |
   | `LVBT_DISCORD_GUILD_ID`            | `1560146082640568350` |
   | `LVBT_DISCORD_PRODUCTION_GUILD_ID` | `1509298455896522823` |
   | `LVBT_DISCORD_MEMBER_ROLE_ID`      | `1560151428180353104` |

   Keep `LVBT_DISCORD_SYNC_ENABLED=false` on both Workers, newsletter synchronization disabled, jobs
   `triggers.crons` empty, and `release.previewOnly=true`. Leave production IDs and flags unchanged.
   The production server ID is a guard: preview must never use it as its active server.

2. The website's release source is `apps/deploy/cloudflare.config.ts`. Its `LVBT_DISCORD_JOBS`
   binding must target `lvbt-jobs-preview` in preview and `lvbt-jobs` in production. Declare the
   preview binding in `.lvbt/tooling.json` too. Regenerate the website compatibility file and types;
   editing only `apps/site/wrangler.jsonc` does not fix a typed release:

   ```sh
   pnpm -C apps/deploy compat:generate
   pnpm -C apps/site build:functions
   pnpm -C apps/site exec wrangler types --include-runtime=false
   pnpm -C apps/jobs exec wrangler types --include-runtime=false
   pnpm check
   ```

3. Leave `LVBT_DISCORD_APPLICATION_ID` unset on the website until the live preview test is approved.
   Website account linking checks the application ID, client secret and private jobs binding; it
   does not check the staff/jobs synchronization flag. Filling that website ID early exposes account
   linking while jobs is still unable to finish joining.
4. Publish the reviewed saved builds only through the approved protected preview procedures. Use the
   staff **setup** stage. Read back both Workers' disabled flags, the empty jobs schedule, the
   isolated database and the website's preview service target. With the approved preview account,
   confirm Discord account linking remains unavailable. If a target differs or linking appears, stop
   and correct the selected source and release; do not enable jobs to conceal the mismatch.

### Run an approved isolated Discord preview

Use this procedure to test real joining and role changes in the isolated server. Preparing or
merging configuration does not authorize live activation or provider writes.

Before starting, obtain explicit approval for the preview activation, the test accounts and their
role changes. Complete the [isolated setup](#prepare-the-isolated-discord-preview), protect the
preview with Access, and prepare a clearly marked non-admin member fixture in the preview database.
Use an explicitly authorized Discord tester, never the preview administrator or an unrelated member.
Confirm the bot has **Manage Roles** and **Create Invite**, sits above every test managed role, and
the app allows `https://preview.lasvegasfortransit.org/account/discord/callback`. Plan the
[shutdown](#shut-down-the-isolated-discord-preview) before enabling anything.

The minute schedule also runs existing preview maintenance and queued Discord work across the
preview database; it is not limited to the marked fixture. Before activation approval, select the
LVBT account in Cloudflare, open **Storage & databases → D1 → lvbt-platform-preview → Console**, and
run each of these read-only statements separately:

```sql
SELECT count(*) AS linked_discord_accounts
FROM identities WHERE platform='discord';

SELECT kind,state,count(*) AS pending_jobs
FROM integration_outbox
WHERE state IN ('queued','running','retry')
GROUP BY kind,state ORDER BY kind,state;

SELECT
  (SELECT count(*) FROM people
   WHERE deleted_at IS NOT NULL AND erased_at IS NULL) AS archived_unerased_profiles,
  (SELECT count(*) FROM people
   WHERE deleted_at IS NULL AND date(created_at)<=date('now','-18 months')) AS older_active_profiles,
  (SELECT count(*) FROM people
   WHERE erased_at IS NOT NULL
     AND julianday(deleted_at)<julianday('now','-30 days')) AS erased_purge_candidates;
```

No pending-job rows means that queue is empty. Require zero linked accounts, pending work and
profile candidates, or privately identify every affected record as explicitly approved disposable
test data. The profile counts are conservative: the age check includes the whole cutoff day and does
not evaluate consent, linked identities, engagement, merge protection or the daily run's exact
cutoff. Check candidates against [the retention rules](../guides/operate-member-data-retention.md)
before deciding what the schedule can affect. Stop before enabling the schedule if any account or
record falls outside the approved test scope; do not delete records merely to clear this check.

1. Prepare the staff/jobs source change first. Set `LVBT_DISCORD_SYNC_ENABLED=true` only in both
   preview configurations and `env.preview.triggers.crons=["* * * * *"]` on jobs. Keep the reviewed
   isolated IDs and database unchanged, newsletter synchronization off, production unchanged and
   `release.previewOnly=true`. Leave the website application ID absent or empty. Regenerate jobs
   types and run `pnpm check` before review. This first change must be safe for automatic website
   preview publication: it must not expose account linking.
2. Select the successful main-branch **Build staff release** run for that reviewed source. After
   live approval, run **Deploy staff preview** with that **release_run** and **stage: launch**,
   following [the saved-release procedure](#prepare-the-saved-artifact). Do not choose **setup**; it
   requires Discord and schedules to remain disabled.
3. Read back the receipt's exact staff/jobs versions at 100 percent traffic and the actual jobs
   schedule containing only `* * * * *`. Run `pnpm staff:preflight --preview --json` with the
   approved scoped credential and require every configuration check to pass. Verify the isolated
   database, Access protection, enabled preview flags and disabled newsletter processing. Stop on a
   mismatch; configuration readiness alone does not prove role changes work.
4. Prepare a separate website change last. Set the preview `LVBT_DISCORD_APPLICATION_ID` text
   binding in `apps/deploy/cloudflare.config.ts` and `.lvbt/tooling.json` to the approved app ID.
   Retain an explicitly empty production counterpart. Regenerate compatibility configuration,
   compile functions, regenerate site types and run `pnpm check` using the commands above. Review
   and publish the saved website preview through its normal protected procedure only after step 3.
   PR and main workflows can publish website previews automatically; do not push this second change
   before staff/jobs readiness is confirmed. Confirm linking appears only on preview.
5. Sign in as the marked member fixture and connect the authorized tester's Discord account. A
   fresh-join test requires an account that is not already in the test server; an existing server
   account cannot prove automatic joining. Confirm the account joins the isolated server and gains
   its Member role. A saved link or queued request alone is insufficient. Verify a recoverable
   failed attempt can be retried without duplicate linking.
6. Assign the fixture to two test committees and confirm both committees' actual Discord roles.
   Remove one assignment and confirm the other entitlement remains. End the fixture's membership and
   confirm the Member and remaining managed roles are removed. An unrelated test role must survive
   every change. In the approved unlinked-account case, confirm staff review is flagged and existing
   roles stay unchanged; never use a real member's access for this check.
7. Keep concise outcomes in the private acceptance record. On failure, stop adding test work and
   follow [activation recovery](#recover-a-failed-preview-activation) or
   [shutdown](#shut-down-the-isolated-discord-preview). Undo only approved fixture changes. Shut
   down website linking first, then staff/jobs and the schedule, and verify the final disabled
   state. Keep production, newsletter processing and unrelated accounts unchanged throughout.

The `/link` command separately needs its public key, guild-only registration and a Discord-reachable
signed interaction endpoint. Do not remove preview Access protection to make that check pass.

## Release order and rollback

### Prepare the saved artifact

The **Build staff release** workflow validates a main-branch source commit, runs the compiled local
runtime suites, builds staff and jobs, and saves `staff-release-<Actions run ID>`. It has no
deployment credentials and does not upload Worker versions or apply migrations. CI also checks
packaging on pull requests.

Before starting a build, confirm the repository's `PUBLIC_LVBT_*` variables under **Settings →
Secrets and variables → Actions → Variables**. The staff build uses the same public website settings
as CI; [the environment example](../../apps/site/.env.example) lists them. Missing social or
donation URLs can fail the website's UI checks before an artifact is saved. Correct the public
variables and start a new build for the reviewed source; an unsuccessful run cannot supply a
release.

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
requires provider readback showing those exact versions at 100 percent. New receipts also retain the
previous and desired jobs schedules. Launch activation applies the saved minute schedule only after
both versions are confirmed active, then verifies it independently. Setup keeps the schedule empty.
The workflow never rebuilds, applies SQL, changes secrets, creates Workers or changes routes.

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

Use the separate **shutdown** stage below to return an enabled preview to disabled operation. Setup
requires the preview to be disabled already; it cannot stop a running preview.

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
acceptance. Production uses the separate protected procedure below and remains blocked while the
production hold is set.

### Shut down the isolated Discord preview

This procedure is for a maintainer authorized to stop the existing test-server integration. Before
starting, keep the reviewed test-server and Member-role IDs, isolated database, Access protection
and existing `staff-preview` deployment credential. Production and newsletter synchronization stay
unchanged. Shutdown stops new linking and scheduled work; it does not cancel provider requests that
are already running or remove roles already granted.

1. Disable website account linking first. In `apps/deploy/cloudflare.config.ts` and
   `.lvbt/tooling.json`'s `release.previewBindings`, set the preview `LVBT_DISCORD_APPLICATION_ID`
   text binding to an empty value, retaining the binding key and the production value. Regenerate
   the website's compatibility configuration and types:

   ```sh
   pnpm -C apps/deploy compat:generate
   pnpm -C apps/site build:functions
   pnpm -C apps/site exec wrangler types --include-runtime=false
   pnpm check
   ```

   Review and publish that saved **website preview** release through its normal protected procedure.
   Confirm the preview account page no longer offers connecting Discord. Do not use a dashboard-only
   setting. The staff release verifier does not inspect or prove this website prerequisite.

2. Prepare a separate reviewed staff/jobs shutdown build. In both `env.preview.vars` sections, set
   `LVBT_DISCORD_SYNC_ENABLED=false`. In jobs, retain `LVBT_BEEHIIV_SYNC_ENABLED=false` and set
   `env.preview.triggers.crons` to `[]`. Keep the application, test-server, production-guard and
   Member-role IDs unchanged and matching on staff and jobs. Keep `release.previewOnly=true` and all
   production settings unchanged. Run the normal full checks and select the successful **Build staff
   release** run for that main-branch source.
3. Run **Deploy staff preview** with that `release_run` and **stage: shutdown**. The protected
   workflow checks the known preview target, saves previous traffic and schedule state, and
   activates only the exact saved disabled staff/jobs versions. It then applies the empty jobs
   schedule and reads it back. A scoped local operator can use the same prepared artifact and an
   unused receipt path:

   ```sh
   pnpm staff:release upload --repository LasVegasForTransit/website --run-id <shutdown-build-run-ID> --directory /tmp/selected-staff-release --target preview --stage shutdown --receipt /tmp/staff-shutdown.json
   pnpm staff:release activate --repository LasVegasForTransit/website --run-id <shutdown-build-run-ID> --directory /tmp/selected-staff-release --target preview --stage shutdown --receipt /tmp/staff-shutdown.json
   pnpm staff:preflight --preview --shutdown --json
   ```

4. Require `shutdownReady: true`, both recorded disabled versions at 100 percent, and an empty
   actual jobs schedule. Verify website linking remains unavailable. Let any prior scheduled
   invocation and provider request finish; inspect the existing Worker logs and test-server roles
   before reporting that no work remains in flight. The configuration check alone does not prove
   cancellation.
5. If a step fails, preserve its receipt. Use **Recover staff preview** with the original build and
   deployment run, **stage: shutdown**, and **operation: inspect** before an approved **resume**. Do
   not substitute a setup/launch receipt or guess versions. Resume skips confirmed activations and
   stops on unexpected traffic or schedules. An uncertain schedule write is never sent again;
   readback can confirm that it succeeded, otherwise stop for operator review.

Restarting requires a separately reviewed preview **launch** release with matching enabled Discord
settings and the saved minute schedule. Publish the website's nonempty preview application ID last,
after staff/jobs versions and the actual schedule are verified. Never use shutdown to change
production, newsletter processing, Access policies or unlinked accounts' roles.

### Publish an approved staff production release

This procedure is for a maintainer releasing staff and jobs after configuration, provider and staff
acceptance. It does not publish the public website. Before you start, complete production Worker,
Access, domain, canonical database/migration and provider setup. The existing staff and jobs
versions must be either valid configured versions or a verified disabled baseline. Jobs must have no
public route or URL. Both applications need their approved authentication and provider bindings;
enabling newsletter processing additionally requires its production publication, encrypted
API/intent keys, and `staff_review` conflict policy.

Create and protect the **`staff-production`** GitHub environment before using the workflow: require
maintainer review and main-only deployments. Set `CLOUDFLARE_ACCOUNT_ID` and the separately approved
`CLOUDFLARE_STAFF_PRODUCTION_API_TOKEN` there. Limit Worker edit permission to `lvbt-staff` and
`lvbt-jobs`; retain the read permissions listed in the configuration-check section. The token needs
permission to update the jobs schedule. A YAML environment reference does not create its review
protections or authorize credentials. Do not reuse the preview deployment key.

1. Complete the separate reviewed launch change. It must clear `release.previewOnly` only after its
   acceptance requirements are met, set the approved production provider flags, and retain
   `triggers.crons: ["* * * * *"]` in the production jobs source. Keep other environments unchanged.
   Both the trusted verifier and selected source must allow production; an older saved build cannot
   bypass a current hold. Production has no setup or shutdown mode.
2. Select the successful **Build staff release** run for that reviewed source. Use **Prepare staff
   release** to check its exact artifact and runtime. Review the saved build and required live
   acceptance before approving deployment. Do not substitute a newer build or rely on passing
   configuration checks as acceptance.
3. Run **Deploy staff production** from `main` with that `release_run`. Approve the protected
   environment only after checking the selected build and target. The workflow retrieves the exact
   saved artifact and checks its source, database, Access, privacy and provider configuration. It
   verifies uploaded bindings, activates the recorded staff/jobs versions, and requires independent
   100-percent version readback before applying the saved jobs schedule. It records the schedule
   intent before its single update request and verifies the complete schedule afterward.
4. Confirm the retained receipt is active with both versions and schedule confirmed. Then verify
   actual sign-in, staff workflows, scheduled membership processing and live provider outcomes.
   Deployment metadata alone does not establish production acceptance. Keep detailed records
   private.

The equivalent CLI commands, using approved credentials and a clean checkout of the selected source,
are:

```sh
pnpm staff:release upload --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target production --stage launch --receipt /tmp/staff-deployment.json
pnpm staff:release activate --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target production --stage launch --receipt /tmp/staff-deployment.json
pnpm staff:release inspect --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target production --stage launch --receipt /tmp/staff-deployment.json
```

Use **Recover staff production** for a failed activation. Supply the original `release_run`, the
completed `deployment_run` holding its receipt, and **inspect** first. A complete, matching receipt
is required; partial uploads cannot be inferred or silently retried. After resolving the reported
gate, choose **resume** with the same inputs. Recovery skips confirmed versions, rejects unexpected
traffic or schedule changes, and never repeats an attempted schedule write. If its response was
lost, readback can confirm the desired schedule; if the outcome remains uncertain, stop and obtain a
reviewed recovery decision. Do not edit receipts, toggle dashboard schedules or redeploy to erase
the uncertainty. Preview receipts cannot authorize production; older preview receipts remain
recoverable but never acquire schedule-write permission.

Only the selected jobs schedule is changed; routes, secrets, migrations and billing remain separate
operations. Serialize deployment/recovery through their shared workflow concurrency group and avoid
manual Worker edits during a release. The
[Cloudflare schedules API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/update/)
does not offer a conditional update: immediate drift checks and recorded recovery protect the flow,
but cannot lock out a simultaneous dashboard edit. Cron propagation and actual execution must be
verified before relying on scheduled processing.

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
version. Neither choice can deploy production or apply migrations. Setup recovery keeps schedules
empty; launch recovery may finish only its recorded schedule after the selected versions are active.

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

| Failure stage                              | Meaning and next action                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `saved-build` or `saved-artifact`          | Verify the original successful build and retained artifact; do not substitute a newer build.                                  |
| `source-checkout` or `saved-configuration` | Restore a clean checkout of that build's source and compare its saved configuration.                                          |
| `receipt`                                  | Verify the selected deployment run, complete receipt, account, and stage. Do not edit or guess recorded versions.             |
| `staff.version` or `jobs.version`          | The uploaded version could not be verified against the saved release; inspect its metadata before any activation.             |
| `configuration` or `setup-boundary`        | Read the named configuration checks and confirm setup keeps Discord disabled and jobs unscheduled.                            |
| `shutdown-boundary`                        | Confirm the disabled preview source retains the known isolated target and all security checks; disable website linking first. |
| `recorded-traffic`                         | Actual traffic differs from an allowed recorded transition or cannot be verified; investigate the provider state.             |
| A Worker `activation` or `readback` stage  | A deployment may have changed traffic; inspect both actual deployments and the retained receipt before resuming.              |

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

## Committee Discord channels

Use an isolated Discord server for the preview. An administrator chooses the server's existing roles
in **Committees → the committee → Edit committee → Account connections**. Staff never need to copy
Discord role IDs. A lead receives the committee role plus its optional lead role; each committee
assignment remains independent.

Before using these controls:

1. Back up the selected membership database and rehearse its pending migrations using the
   [backup guide](../guides/back-up-membership-database.md). Apply the reviewed canonical
   migrations, including `0042_committee_discord_leads.sql`, through the approved release path
   before activating the corresponding staff and jobs build.
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
   actions. **Add to committee** changes the canonical assignment. Removing an unexpected Google
   holder leaves their LVBT membership intact and records **Removed from access page**. Inherited
   access must be reviewed in Google Admin; a direct group removal cannot establish that inherited
   access ended.
4. Open a member for committee changes or an access retry. A retry records who requested it and the
   reason. Requests are not completed access changes; only a confirmed provider change appears in
   the corrections list. Unmatched Discord accounts stay unchanged while staff reviews them.
5. Review **Discord corrections in the last seven days** for completed changes. The member profile's
   **Access history** retains the longer administrator-only history, including automatic changes and
   the staff requester when available.

Migration `0043_access_mismatch_observations.sql` adds operational first-noticed dates for known
Google direct membership and Discord role differences. Apply all canonical migrations in order
before uploading this version, following
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
this same writer with their existing provider fences. Workspace-account, GitHub and checklist
callers can use it without claiming that those integrations are deployed.

`listAccessChanges` reads the same immutable history for all systems. Its filters, current
administrator check and newest-first pagination run against stored records. Privacy erasure redacts
personal details while retaining the permitted action, actor and time; the reader never reconstructs
redacted targets. Ordinary updates cannot edit the log. The existing three-year maintenance policy
applies to every supported action.

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
consent provenance, and duplicate resolution before any import is separately authorized. This
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
outcomes, provider readback and recovery, three staff sessions including assistive technology, and
the agreed week of production use before declaring launch complete. Keep member contact data and
private task tracking out of public release evidence.
