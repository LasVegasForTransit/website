# Staff newsletter delivery and cleanup

Maintainers use this reference to configure scheduled newsletter delivery and verify account
cleanup. Staff administrators use **Resolve newsletter follow-up** to resolve mailing-list
differences. Beehiiv hosts the mailing list; the private jobs Worker applies changes saved in the
membership database. A successful signup does not prove that Beehiiv received it.

Before changing an outside service, select the environment and obtain the approvals named in the
procedure. Keep production keys and member data out of preview. Use the local fixtures for ordinary
tests. Local success and configuration checks do not establish production acceptance.

Choose the section for your task:

- [Scheduled newsletter processing](#scheduled-newsletter-processing).
- [Resolve newsletter follow-up](#resolve-newsletter-follow-up).
- [Verify newsletter cleanup after account deletion](#verify-newsletter-cleanup-after-account-deletion).

## Scheduled newsletter processing

This procedure is for a maintainer preparing newsletter synchronization. Keep Beehiiv on Free and
use **LVBT Updates** as the only publication. Free supports API access; scheduled polling and
outgoing subscription changes do not require webhooks or another account. A list observation shows
delivery status, not when someone last changed their consent.

Before you start, complete [staff preview setup](../guides/set-up-staff-preview.md) and use local
fixtures for ordinary preview testing. Keep `LVBT_BEEHIIV_SYNC_ENABLED=false` on both hosted
previews and production during setup. The preview runtime rejects the production publication;
preserve that guard and keep live Beehiiv credentials out of preview. A separate test database does
not prevent a live Beehiiv key from changing the real mailing list.

Keep `release.previewOnly=true` in `.lvbt/tooling.json` while queued newsletter delivery has not
passed its production launch requirements. While this hold is set, shared release commands refuse
production promotion, upload, activation, and saved-release migrations. Preview packaging and
verification remain available. This hold also blocks unrelated website production updates from this
source revision; do not remove it merely to publish another change. Retain the last accepted
production release until newsletter source review, data export/deletion, provider configuration, and
actual workflow and provider acceptance are complete. Remove the hold only in a reviewed change that
enables and verifies the consumer before the website begins relying on queued updates.

1. Apply the selected release's migrations using the preview guide, then verify that the selected
   database contains the newsletter inbox, attempted writes, erasure tables, and
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
[protected saved-release procedure](./staff-release-operations.md#publish-an-approved-staff-production-release).
The production hold still blocks uploads, activation and schedule writes. Keep schedules and
synchronization disabled until the separately reviewed launch change and acceptance are complete.

Once production launch is approved, set `LVBT_BEEHIIV_SYNC_ENABLED=true` and `triggers.crons` to
`["* * * * *"]` in the top-level production settings in `apps/jobs/wrangler.jsonc`. Preview keeps
`env.preview.triggers.crons=[]`; ordinary preview launch and resume cannot enable its cron. Update
that environment's disabled-state expectations in `apps/jobs/tests/configuration.test.ts`,
regenerate Worker types, and run `pnpm check`. The reviewed release path must apply and read back
the approved schedule as well as activate the saved code; version activation alone does not change
cron triggers. Verify actual scheduled processing before accepting launch. Dashboard-only cron edits
do not survive later uploads. Leave other environments disabled and retain the `release.previewOnly`
hold until its separate removal requirements above are met.

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

This one-use operator API procedure acts on **LVBT Updates**, separate from the ordinary preview
runtime. The application has no live test mode or single-address test endpoint. Keep hosted
synchronization disabled throughout. Checking the API afterward proves only these provider
operations; it does not prove the scheduled consumer, member signup, staff review, deletion flow or
Discord permissions work end to end. Those remain launch acceptance requirements.

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

### Inspect saved processing

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

These tables require the release's newsletter database migrations. The presence of saved events or
passing local tests does not establish hosted processing. Keep synchronization disabled until the
scheduled incoming dispatcher, staff resolution of review cases, and approved live provider
acceptance have all been verified.

The worker applies saved member choices received from Beehiiv before sending changes to Beehiiv.
After the roster scan, saved status differences are processed before outgoing changes, including
while Beehiiv requests are paused by a rate limit. One incoming invocation handles at most three
ready changes, and a scheduled tick runs at most six such batches, followed by at most six
observation batches. Each invocation enforces the 50-query limit. The parent and its loopback calls
together stay within 32 invocations, with a call reserved for completion. Optional work stops after
its 50-second dispatch deadline; unfinished work resumes on the next tick.

The roster scan handles up to three pages of 100 accounts per tick. A 5,000-account roster therefore
needs at least seventeen successful ticks, and longer during pauses or a slow provider. Check actual
queue age and scan completion during hosted acceptance before relying on that capacity. A roster
status observation does not establish when someone gave or withdrew consent.

A linked inactive status withdraws consent automatically only when a prior active observation or
confirmed active delivery establishes that the signup preceded the unsubscribe interval. The record
uses the date the status was observed. It explicitly leaves the original unsubscribe date unknown.
An uncertain interval follows the configured conflict policy and remains available for staff review.
Paused and undeliverable email statuses do not withdraw membership. Observing an active subscription
never creates or renews permission to email someone.

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
without holding up other ready events. If the worker cannot read an address, match its owner or
establish the order of choices, it saves the case for staff review. It pauses outgoing changes for
that account. An administrator resolves the case through **Newsletter follow-up** below; retrying
alone cannot decide which consent is valid. Do not clear an error by editing consent, deleting
attempted-write evidence, or bypassing ownership checks. A callback is a message Beehiiv sends after
a subscription changes. A callback caused by the platform's own creation request clears without
adding consent. A confirmation or removal that may repeat the platform's own request needs
independent evidence before it can change consent. If Beehiiv reports times only to the second, the
worker cannot establish which of two choices made in that same second came first.

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
   IDs, fabricate an old signup, or delete a flagged newsletter preference merely to unblock
   sending.
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

These checks exercise the membership tables locally; they do not establish that a hosted provider
has deleted its subscriber. Verify that separate outcome during approved live provider acceptance.

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
unsubscribe. Historical receipts keep the subscriber ID needed to finish that cleanup, including
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
