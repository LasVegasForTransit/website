# Platform database schema

This page describes every table and column in the Organizing Platform's database, in one plain
sentence each. The database is Cloudflare D1 (see the
[glossary](../../../docs/reference/glossary.md#d1)). The numbered `.sql` files beside this page are
the migrations that build it; running them in order on an empty database creates everything below.

No table stores a street address. Location is a ZIP code and a census block only.

## Apply the migrations

```sh
pnpm exec wrangler d1 migrations apply lvbt-platform --remote                      # production
pnpm exec wrangler d1 migrations apply lvbt-platform-preview --env preview --remote  # previews
pnpm exec wrangler d1 migrations apply lvbt-platform --local                       # your machine
```

Wrangler records which migrations have run in a `d1_migrations` table, so running the command again
changes nothing. `pnpm exec wrangler d1 migrations list lvbt-platform --remote` reports what has
run.

## people

One row per human LVBT knows about, whether or not they are a member.

| Column                      | Meaning                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`                        | The person's sortable unique identifier (a ULID).                                                                     |
| `given_name`, `family_name` | Their first and last name, if they gave them.                                                                         |
| `email`                     | Their email address, trimmed and lowercased; unique among people who are not deleted.                                 |
| `email_verified_at`         | When they proved they own the email address, if they have.                                                            |
| `phone`                     | Their phone number in international form, such as `+17025550123`.                                                     |
| `zip`                       | Their 5-digit ZIP code.                                                                                               |
| `census_block`              | The 15-digit code of the 2020 census block they live in, worked out once from an address that was then thrown away.   |
| `census_block_vintage`      | The census year of that block, `2020`.                                                                                |
| `place_name`                | The Census place their block is in, such as `Paradise CDP` or `Henderson city`.                                       |
| `region_id`                 | Their LVBT region, from the `regions` table.                                                                          |
| `region_source`             | How the region was set: `address`, `member_choice`, `zip` or `staff`.                                                 |
| `region_set_at`             | When the region was last set.                                                                                         |
| `preferred_language`        | The language they read LVBT's screens in; `en` for now.                                                               |
| `membership_status`         | `member`, `former_member` or `not_member`, computed from their consent under the membership rules and never typed in. |
| `membership_rules_version`  | Which version of the membership rules computed that status.                                                           |
| `created_at`, `updated_at`  | When the row was created and last changed.                                                                            |
| `deleted_at`                | When the entry was archived by a merge or explicitly deleted. The thirty-day physical-removal job is still pending.   |
| `erased_at`                 | When explicit deletion erased personal fields and saved copies; merge archival alone leaves this empty.               |

## consent_records

Evidence that a person agreed to something. Historical roster imports also retain the linked
provider identity and private import run, alongside the original consent and withdrawal timestamps.

| Column                             | Meaning                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`, `person_id`                  | The record and the person it belongs to.                                                                          |
| `scope`                            | What they agreed to: `newsletter`, `event_reminders` or `volunteer_contact`.                                      |
| `given_at`                         | When they agreed.                                                                                                 |
| `source`                           | Where they agreed, such as `join_form`, `newsletter_box`, `google_form` or `external_form` (any other form tool). |
| `method`                           | How: `checkbox`, `double_opt_in`, `paper_signature` or `unknown`.                                                 |
| `wording_version`                  | The exact wording they saw, such as `join-form-v1`.                                                               |
| `withdrawn_at`, `withdrawn_source` | When and where they took it back, if they did.                                                                    |

Historical roster imports keep the provider's original consent and withdrawal timestamps. The
`consent_import_origin_given` index makes a repeated import of the same provider event a no-op.
Imported evidence is linked only after identity matching succeeds and any possible-duplicate review
is resolved. A newer local withdrawal prevents an older active roster snapshot from restoring
membership; a newer active consent is not undone by an older imported withdrawal.

## field_sources

Where each field on a person came from: one row per person and field, naming the source that last
set it and when.

## identities

A link between a person and their account on another platform.

| Column           | Meaning                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `platform`       | `beehiiv`, `notion_intake`, `google_workspace`, `discord`, `givebutter` or `luma`.                  |
| `external_id`    | The account's identifier on that platform; unique per platform.                                     |
| `external_email` | The email address that platform holds, if any.                                                      |
| `link_method`    | How the link was made: `verified_email`, `staff_confirmed`, `self_linked` or `created_by_platform`. |

## engagement_events

One timestamped thing a person did, such as joining. Events are only ever added: a database rule
refuses any change to an existing event. `details` holds extra facts as JSON, for example the
interests ticked on the join form.

## review_queue

A possible match between two people that a staff member confirms (`merged`) or rejects
(`kept_separate`). `reason` says why the pair was queued, and `details` holds anything the incoming
record said that couldn't be stored on the new person, such as an email another person already has.
Each pair is queued once per reason. Keeping a pair separate resolves all of its pending reasons and
prevents any reason from queuing that pair again, in either direction. The rules are in
`platform/storage/person-service.md`, "Matching".

## onboarding_actions

Featured actions for the member welcome email and welcome page. `id` identifies the action.
`referral_source` optionally names its campaign or partner; someone arriving from that source sees a
different action instead of being sent back. `interest` optionally targets one of the join form
interests, so an event or public meeting can reach the people who selected it. `title`,
`description`, `label`, and `href` are the visible action. `starts_at` and `ends_at` are UTC ISO
timestamps; `priority` selects among overlapping actions; `active` allows staff to turn one off
without deleting it. Add or edit rows in D1 to change the featured action without changing
application code. Migrations 0007 and 0008 seed Week Without Driving as the first time-limited
action and assign its referral source.

## merges

The record of two people combined into one, with the moved rows as JSON so the merge can be undone.

## membership_rules

The versioned definition of who counts as a member. Version 1: anyone with an active newsletter
consent is a member; someone who withdrew it is a former member.

## regions and zip_regions

`regions` lists LVBT's ten regions. `zip_regions` holds, for each ZIP code, the share of its 2020
population in each region; a ZIP code sets a person's region only when one region holds at least 90
percent. It is empty until the ZIP crosswalk is built, so for now members whose region can't be told
from an address choose it themselves.

## rate_limits and form_submissions

`rate_limits` counts attempts per hashed caller per hour, so the join form can refuse an eleventh
join from one connection. The caller is stored only as a keyed hash, never as an IP address.
`form_submissions` remembers each join form's one-time token, so submitting the same form twice
joins the person once.

## intake_submissions

One row per submission to the intake interface, keyed by the idempotency key the form tool sent,
with the answer LVBT gave. A repeat within 30 days gets the same answer and changes nothing. See
[connect a form tool](../../../docs/guides/connect-a-form-tool.md).

## Workspace sign-in and linking

Migration 0009 adds `workspace_oauth_states`, with ten-minute state hashes, PKCE verifiers, nonces,
fixed callbacks and the initiating deployment origin. A state is consumed atomically.
`workspace_callback_tickets` carries verified claims for at most one minute; the initiating browser
must prove its original state cookie before a ticket can create a session or start linking. Google
access and refresh tokens are not retained.

`workspace_pending_links` holds a verified Google identity for a fifteen-minute linking step, keyed
by a secret-derived token hash. `workspace_link_operations` records identity ownership for retries.
The `workspace_link` purpose in `sign_in_codes` requires `workspace_link_id`; other code purposes
cannot supply one. Codes are consumed atomically and concurrent wrong attempts increment the same
counter.

Staff sessions can reference `workspace_identity_id`. Protected staff entry requires that identity
still belongs to the session person. Staff sessions do not verify a different personal email.
Deleting an identity clears the reference and invalidates protected staff entry.

Workspace accounts are issued only to existing LVBT members. Linking never creates people or
consent. Only an active member can receive a linking code, link a Workspace identity or begin a
staff session. Every protected session read checks current membership; withdrawal invalidates staff
access even while the session cookie remains unexpired.

## Staff roles and operations

Migration 0010 seeds `committees`. Settings hold each committee's Workspace group, Discord role and
mapping to join-form interests. `committee_assignments` retains past assignments; a partial unique
index allows one current assignment per person and committee. Roles are member or lead. Ending an
assignment records who ended it and why.

`staff_administrators` contains explicitly designated administrators. The initial designation
requires the president's existing active member record and linked Google subject. Database guards
prevent removing the last administrator. `staff_operations` records actor, operation identity,
payload, result and application time so retries do not apply a mutation twice. `staff_audits`
attributes staff changes without retaining contact details in denial receipts.

`reconcile_generations` and `integration_outbox` separate accepted assignments from provider work. A
newer assignment generation supersedes an older queued operation; a failed provider call leaves the
assignment in place for retry.

## Staff forms, views and welcome claims

Migration 0011 adds `staff_form_tokens`, which stores hashed, actor-and-action-bound tokens for 30
minutes. Consumption is atomic and requires current staff eligibility. `person_views` stores only
viewer and target IDs and the view time.

`welcome_claims` contains at most one current claimant per member. A claim expires after seven days;
an expired claim can be replaced atomically. Queue eligibility uses the beginning of the current
active newsletter-consent period, rather than the date a person record was first created. The
ordinary queue covers the last 60 days and orders the longest waits first. Queue rows contain no
email or phone. An owned claim remains actionable until expiry when its member ages past the queue
window.

Contact reads and mutations check current active membership and the viewer's current administrator
designation or committee-lead interest mapping. Claims confer no permission to view the full member
profile. Completion removes the claim and appends one `welcomed` engagement event with method, note
and actor in the same batch as its operation receipt and audit. A failed write rolls back the whole
batch. Retry identities are scoped to the actor, person, action and exact payload.

## Staff corrections and duplicate decisions

Migration 0012 adds `person_corrections`: each row records the affected person, administrator,
required reason, exact old/new field values and previous sources, operation ID and correction time.
Corrections are append-only and share a transaction with the canonical field write, `staff` field
sources, attributed engagement event, audit receipt and pending `person_reconcile` outbox entry. The
`person` reconciliation target has a generation so a newer correction invalidates older work.
Provider success is not implied by this pending operation.

Correction permission and original values are checked again inside the write transaction. A stale
form or conflicting email produces no partial change. Changing email clears its verification and
invalidates existing sessions and codes; it does not change a linked Workspace identity or create
consent. Changing ZIP clears derived geographic facts while preserving a region explicitly chosen by
staff or the member. Membership and consent cannot be edited through the correction field API.

A keep-separate decision is administrator-only. It atomically resolves every pending review reason
for the unordered pair, records the deciding actor/time and optional note, and adds one
`duplicate_reviewed` event per person. Repeated identical operation IDs return the same decision;
changed payloads conflict. Comparison reads audit both person views and never grant a lead access to
the duplicate queue.

A combination archives one person and keeps the other as the live member profile. `merges` stores
its administrator, required reason, operation ID, exact moved row IDs and original values. Consents,
withdrawal evidence, identities, engagement events, committee assignments, corrections and signup
receipts move by their original keys. Existing contact details on the chosen entry remain; blank
fields can receive the other entry's details and source. Original field sources and administrator
designations remain on the archived entry for undo; a needed designation is copied to the survivor.
Historical audit actors and targets remain unchanged. An intake submission stores no person ID and
needs no ownership change.

The transaction compares complete, ordered snapshots and checks current administrator authority
before accepting a receipt. Conflicting contact emails, external platforms, current assignments or
unique event references cause no partial change. Engagement and correction content stays immutable;
only a recorded ownership movement during a pending merge or undo receipt is permitted by their
triggers. Merge bookkeeping rejects ordinary edits; explicit deletion can irreversibly erase
personal copies as described below. Sessions, codes, affected form tokens and welcome claims are
invalidated, and pending provider work for both people is superseded and replaced with current
person-reconciliation jobs. The archived person's cleanup job is valid only while its recorded
combination remains active; undo advances both generations.

`consent_withdrawals` records each actual withdrawal request even when there is already no active
consent. Its original request owner is immutable, so two entries with the same withdrawal retain
both pieces of evidence after being combined. A newer withdrawal suppresses older active consent
without manufacturing a new consent. A later rejoin remains active. Undo restores only the saved
movements and copied blank fields, preserves later activity and account additions, and respects
withdrawals recorded after the combination. A replaced or reassigned account, changed copied field,
deleted person or other incompatible restoration returns a conflict. Removed identities are never
recreated.

Active combination archives are reversible records, not ordinary deletion candidates. Explicit
deletion erases the current profile and associated archived fields and snapshots. Undo refuses
erased, deleted or modified archives. Physical removal after thirty days and legacy-deletion cleanup
remain unfinished; provider cleanup IDs must stay available until managed access has been removed.

## Committee settings and managed account mappings

Migration `0013_committee_settings.sql` adds a description, time commitment, acceptance of new
assignments and a monotonically increasing settings version to each of the nine committees.
Disabling new assignments preserves current assignments, lead authority and history; it does not
request account removal. The assignment receipt checks acceptance inside its transaction. Ending an
assignment remains available when a committee is paused.

Only a current member with a staff-administrator designation can save settings. Saves require the
expected settings version, use an exact-payload operation receipt and append an attributed audit
with before and after values. Welcome interest mappings use the existing join-interest IDs.

`committee_account_mappings` retains every configured Google group email and Discord role ID,
including superseded and cleared mappings. A mapping remains assigned to its original committee, and
cannot be reassigned to another committee or erased through settings. This registry allows
reconciliation to remove earlier managed access after multiple settings changes. It stores no person
records or credentials. Changing connections advances reconciliation generations and queues current
work for non-deleted people with current or past assignments; old grants become superseded.
Metadata-only changes do not request provider work. Provider observations and actual account changes
remain the responsibility of the reconciliation runner.

### Access confirmations (0014)

`access_observations` stores bounded provider reads, separate from saved membership and committee
assignments or completed outbox writes. Each row binds a person, target, provider, stable external
account (and Workspace email), mapped resource, server/domain context, generation, expected access,
read time and expiry. States are granted, absent or unknown; errors use a small failure enum, never
raw provider responses. The writer rejects changed accounts, changed committee mappings, newer
assignment generations, membership changes, ambiguous account links, future reads and confirmations
lasting more than five minutes. The read view also requires current runtime provider configuration.
An expired or superseded observation cannot prove access. Rows cannot be updated; a new read appends
an observation. Retention must erase these account references with the person's personal data and
remove obsolete observations independently of the three-year attributed access audit.

Access recovery requeues only the current failed reconciliation and audits the retry atomically.
Administrator removals use the committee assignment transaction, ending the authoritative assignment
and queuing the new removal generation. Retrying removal never reinstates an assignment.

### Discord synchronization (0015)

`provider_account_leases` serializes provider requests for a stable account and server across Worker
instances. A lease lasts thirty seconds and must be renewed before each mutation; expired workers
cannot save observations, retries, profile data or receipts, or release a newer worker's lease.
Discord requests have a separate bounded timeout, including response-body reads. A timeout cannot
prove whether a remote write applied; retries and periodic reconciliation must read actual state.

`discord_profiles` holds Discord username, display name, avatar and server nickname, presence and
screening state. It references the existing identity row and is erased when that identity is erased.
These external fields never replace LVBT name, email, phone or consent. Current role confirmations
remain in `access_observations`; an API write acknowledgment alone does not establish a role.
Equal-time observations use database insertion order so a later failed read cannot lose to a random
identifier from an earlier granted read.

`provider_operation_receipts` records each provider's independent result, the canonical-plan digest
and lease token. A Discord success does not finish a shared outbox job while other provider work is
unproven. The Discord plan includes current membership, stable identity ownership, all assignment
generations and all current and retired managed role mappings. Preview and production server IDs are
separately pinned. Requests remove retired roles individually and preserve unrelated roles; grants
wait until server screening is complete. Saving a result rechecks current identity, membership,
generation, job and lease inside the database transaction.

The adapter, storage pipeline and scheduled Worker have local fixture coverage. Complete provider
orchestration, maintainer release setup and live server acceptance remain required before this can
be claimed operational.

### Discord account linking (0016)

`discord_link_states` binds a ten-minute, one-use authorization to a hashed browser state, the
member's live session and the exact public or preview origin. Claiming the state precedes the OAuth
exchange. Completing it rechecks session, current membership, expiry and exclusive stable-account
ownership inside the transaction. Sign-out deletes the bound flow; withdrawal prevents completion.
An authorization cannot replace a different connected account or resolve ambiguous identities.

`discord_identity_profiles` keeps the verified username, display name and avatar separate from LVBT
contact information and consent. Member downloads include only their own account and server
profiles. Account deletion erases both profile snapshots immediately while retaining stable IDs
needed to remove managed access. No OAuth access token, refresh token or authorization code is
saved.

Linking saves the verified identity and profile, attributed audit, new reconciliation generations
and replacement person/committee jobs atomically. An audit failure rolls back the entire write.
Prior outstanding generations are superseded. Linking establishes account ownership; only an actual
server read can establish presence or roles. Migration 0016 has not been applied to production.

### Shared provider pauses (0017, 0028)

`provider_backoffs` binds a persisted rate-limit deadline to a provider context: Discord application
or Google Workspace customer. Restarting the Worker or processing another account cannot bypass that
pause. A later shorter retry cannot shorten an existing deadline. Dispatchers check it before
selecting work and between accounts; HTTP transports check before each request. It stores neither
credentials nor provider response bodies. Discord non-global rate limits conservatively pause the
application as well; Workspace quota responses pause that customer.

### Membership changes and queued work (0018)

Consent changes recompute the version-one membership cache within the same transaction. A changed
membership advances the person and known committee generations, supersedes obsolete work and queues
current reconciliation for people with provider accounts or existing generations. Failed enqueueing
rolls back consent, withdrawal evidence, membership and queued work together. Rejoining supersedes
an unfinished removal; unchanged membership creates no redundant generation.

The scheduled Discord dispatcher selects only current, due work with unambiguous verified account
links. It avoids fresh completed Discord receipts without marking other provider work complete.
Never-confirmed accounts are processed ahead of expired confirmations. Deletion and archived merge
cleanup use the additional ownership guards described below. Complete shared-provider orchestration
remains unfinished. Migrations 0017 and 0018 have not been applied to production.

### Periodic provider scans (0019)

`provider_scan_checkpoints` stores a Discord server's scan start, next due time, person-ID cursor,
completion time and bounded lease. Pages select live people with exactly one verified Discord
identity, including former members. A completed scan starts again at the next UTC hour; unfinished
scans resume their existing cursor. Each queued job uses the current person generation. Existing
current person or committee work is reused, including deferred retries.

Generation initialization, queue insertion and checkpoint advancement commit together and recheck
the current scan lease, cursor, server and identity eligibility. Failed writes cannot skip a page;
expired workers cannot overwrite resumed scans or release a successor lease. The checkpoint stores
no contact or provider profile fields. Scan completion proves queue coverage, not provider
convergence. Migration 0019 has not been applied to production.

### Deleted account cleanup (0020)

The deletion trigger advances existing person and committee generations, supersedes old work and
queues a person reconciliation bound to the original deletion timestamp. It excludes active merges,
which retain their own jobs and ownership transfers. The upgrade also queues previously deleted
ordinary accounts and removes their obsolete access confirmations. Failed queue insertion rolls back
the deletion transaction. Repeated deletion preserves the timestamp and creates no new job.

The Discord runner accepts cleanup only with the current generation, matching deletion timestamp and
verified identity still owned by that record. Deleted plans grant no roles and retain all managed
mappings for removal. Ownership transfer or merge undo invalidates delayed work before mutation or
receipt persistence. Cleanup writes neither profiles nor access observations for a deleted person;
failures retain sanitized retry state. Independent receipts do not complete other providers' work.
Migration 0020 has not been applied to production.

### Confirmed provider access changes (0021)

`provider_access_intents` stores a Discord role's pre-write state and expected change, stable
person, account, server and role IDs, canonical revision, operation, reason and optional requesting
staff person. Preparation rechecks the current job lease, identity ownership, membership, target
generation and managed mapping. It stores no provider response body, contact details or credentials.
Repeating the same attempt preserves its intent; a changed canonical revision replaces an obsolete
intent.

A validated provider read matching the intended result appends an `access.granted` or
`access.revoked` entry to the existing shared `staff_audits` table and removes the corresponding
intent atomically. An audit failure preserves the intent for a later read. Unchanged roles produce
no entry; an actual later drift repair produces its own entry. Pending or denied writes do not imply
access was granted. Deleted-record cleanup records stable IDs without recreating profile or access
observation data. Administrator profiles show actual provider changes; committee leads receive only
their authorized committee history on the account-updates page.

The common writer for other systems remains unfinished. Audit retention and deletion protection are
described below. Migration 0021 has not been applied to production.

### Audit retention and expired welcome claims (0022)

`audit_retention_scope` is created and removed inside one maintenance transaction. It contains only
the scheduled clock and calendar-year cutoffs, validated against that clock. Audit deletion triggers
require both this scope and an entry older than its cutoff: one year for `person_views`, three years
for `staff_audits`. Exact-cutoff entries remain. Both audit tables reject ordinary updates. The
explicit-erasure exception below permits only redaction of staff audit details; action, actor,
target, time and receipt stay unchanged. An accidental deletion outside maintenance fails, including
deletion of an already old entry. A failed maintenance batch rolls back its deletions and the scope
together. No deletion permission persists after success or rollback. Privileged database
administrators still control the schema; this is an application write safeguard, not a separate
database authorization system.

`runMaintenance` removes at most 100 entries per category by default, with a maximum requested bound
of 1,000. It also expires welcome claims at or before their current deadline in the same
transaction, leaving renewed claims intact. Profile cleanup is described under migration 0025 below.
The scheduled Worker runs this independently of Discord readiness and logs only counts. Migration
0022 has not been applied to production.

### Paper signup batches (0023)

`paper_batches` stores the entering staff member, event name and date, sheet wording version,
payload digest and completed receipt. Contact fields stay in the shared person records rather than
being copied into the receipt. A batch commits its people, field sources, explicit newsletter
consent, attendance, duplicate-review entries and attributed import audit together. A repeated batch
with the same actor and payload returns its receipt; changed payloads conflict. Current staff
authority and matching email ownership are checked inside the batch, preventing partial imports when
those facts change during entry.

The entry form starts with five rows and accepts up to twelve. Adding rows, validation errors and
expired forms preserve entered values without JavaScript. Blank rows are skipped. Consent requires a
marked signup box and the supported wording printed on the sheet; attendance alone creates no
membership. Verified email matches preserve known contact fields. An unverified match queues a
possible-duplicate review and withholds the conflicting email rather than transferring ownership.

The sheet records a calendar date, not an event time. Future dates are rejected using the Pacific
calendar. A withdrawal on or after the start of that Pacific day prevents historical paper consent
from renewing membership; the saved receipt explains affected signups. A withdrawal on a prior
Pacific day permits renewal, including across UTC midnight and daylight-saving changes. The twelve
row sheet prints on one US-letter page. The native browser suite verifies the protected compiled
Worker, keyboard field order, a 320-pixel viewport and the rendered print artifact. These are local
checks; migration 0023 has not been applied to production and external mailing-list delivery is not
confirmed by an intake receipt.

### Staff record downloads

`collectFullExport` reads live person records and their consent, identity and activity history in
one D1 batch with the attributed `people.export` audit. Every query checks current administrator
membership and designation. Permission is checked again before an archive is returned. An audit
failure prevents delivery. Deleted people and their related rows are excluded. Current and former
members and other undeleted contacts retain their recorded membership status.

The protected `/export/` page uses a same-origin POST and a single-use form. The download has
exactly six entries: `people.csv`, `consent_records.csv`, `identities.csv`, `engagement_events.csv`,
`export.json` and `README.txt`. The CSV files contain the same primary records as JSON. JSON also
preserves field sources, committee assignments, withdrawal requests, corrections and stored Discord
profiles. Formula-like spreadsheet cells receive an added apostrophe; JSON retains the original
values. Quoted commas, quotes and line breaks are preserved. Authentication credentials, sign-in
codes, sessions and OAuth state are excluded.

The ZIP uses the pinned browser entry of `fflate` and streams file chunks without Node workers. The
filename uses the Pacific calendar date and responses forbid caching.
`pnpm -C apps/staff test:export` verifies an actual browser download from the compiled HTTPS Worker
with JavaScript disabled, consent records, current lead denial, expired forms, same-origin
enforcement and an attributed audit. The local fixture exported 5,005 people within the
thirty-second target; hosted preview performance and production release are still unverified.
Independent ZIP CRC and CSV/JSON comparison checks passed on that generated artifact. This does not
complete deletion retention.

### Explicit profile erasure (0024)

`deletePersonData` resolves the current active combination inside one D1 transaction. It clears
names, contact and location fields, email verification and saved language preference on the current
profile and its archives. The irreversible `erased_at` marker distinguishes this from an undoable
merge archive. Database guards prevent reviving an erased row or restoring its personal fields.

Correction snapshots and results, activity details, field-source rows and duplicate-review copies
are erased with their owner. Account email/profile copies and pending Workspace claims are removed;
sessions, codes, Discord linking states, staff forms and welcome claims are invalidated. Stable
external account IDs, generations and provider cleanup work remain available for access removal.
Consent evidence is removed with expired profiles by migration 0025. An origin ID attached to
another live person’s withdrawal remains as attribution rather than preventing profile cleanup.

Historical copies follow overlapping intervals in recorded operation order, including nested
combinations subsequently undone. Monotonic receipt ordering distinguishes actions in the same
millisecond and remains valid when the wall clock changes. Existing receipts are backfilled in their
original insertion order. Legacy merges without receipts use conservative copy intervals; their
precise selectivity remains unverified. Their saved profiles and full-profile correction results are
erased without changing separated members' current profiles. A later independent combination remains
reversible. If an archive contains only a third person's duplicate-review copy, only that review
copy is removed; the other members' combination can still be undone. Retained audit actions keep
attribution and time while their associated free-text details receive an irreversible erasure
marker.

The temporary erasure and copy scopes are created and removed in the same transaction. Failure rolls
back profiles, snapshots, scope and newly queued cleanup together. Repetition changes nothing.
Concurrent merge/undo receipts compare current snapshots before applying and cannot restore erased
information. Completion writes for corrections, reviews, combinations and committee settings update
only their own operation receipt, preserving unrelated saved results and retries.

These guarantees have local storage and compiled HTTPS staff/Discord runtime checks. Migration 0024
has not been applied to production. The next migration adds physical profile removal and legacy
erasure backfill; old unconfirmed provider-intent retention remains unfinished.

### Expired profiles and stable internal keys (0025)

`people` holds personal profiles. `person_keys` holds only their opaque internal ID and deletion and
erasure timestamps. Existing foreign keys are moved to this key table without deleting or copying
identity, receipt, intent or attribution rows. Profile business triggers are recreated against
`people`, including membership updates, access scheduling, last-administrator protection and erasure
guards. New profiles create their key inside the same statement. An erased key cannot be reset and
its profile cannot be recreated, including through SQLite replacement writes. Personal-record and
account-profile guards also reject late inserts or updates owned by an erased key. Origin and actor
references on another person’s records remain valid.

Maintenance first backfills up to 100 ordinary deletion roots, applying the same immediate erasure
and saved-copy rules as an explicit deletion. Associated active combinations are erased together;
the root bound does not split such a group. An intact reversible merge archive is excluded. Then a
separate scope selects at most 100 erased profiles strictly older than thirty elapsed days. Profiles
exactly at the cutoff remain. Current-owned consent evidence, withdrawals, form receipts, Workspace
link receipts, assignments and staff designation rows are removed with the profile. Withdrawal
origins and actor references owned by other records retain only the opaque key. Selection, erasure,
child cleanup, profile deletion and scope removal share the audit-maintenance transaction. Cleanup
also removes personal copies left by late writes from older deployments before these guards existed.
A failure rolls all of it back. Direct profile deletion outside this validated scope is rejected.

`reconciliation_people` exposes live profiles plus erased keys whose profile has been purged. It is
used only by the provider worker; staff sign-in, search and member pages still require a profile.
Deleted access plans normalize membership to `not_member` before and after purge, preserving an
interrupted removal's revision and saved intent. Verified external IDs, generations, queued provider
work and unconfirmed intents remain available. A validated provider read can still confirm removal
and write its audit receipt without recreating profile or access-observation data.

Storage tests cover exact cutoffs, bounded repeats, legacy erasure, reversible archives, rollback,
origin and actor attribution, and pending removal after purge. An upgrade fixture preserves every
existing row, including pending intents and receipts, before exercising undo and restored membership
and audit guards. Compiled scheduled-Worker checks additionally exercise bounded actual D1 cleanup
and Discord removal after physical profile cleanup against an isolated provider fixture. These are
local acceptance checks. Large connected merge groups still need Worker-budget validation. Migration
0025 has not been applied to production. Retiring retained operational keys, identities and old
unconfirmed intents after all providers finish remains open; pending removals must not be silently
discarded to meet a storage deadline.

### Google group reconciliation (0026)

`google_group_checkpoints` records fresh per-group readback for an outbox operation and canonical
plan revision. A changed assignment, link, membership or mapping invalidates earlier checkpoints.
They expire after five minutes and disappear with their outbox operation. They contain group keys
and receipt metadata, without a member email or personal profile. The account-level Google receipt
requires all groups in the current plan to be confirmed in the same conditional write. Its expiry
cannot exceed the earliest group proof, and future-dated checkpoints are refused. It never completes
other providers.

### Google periodic scans (0027)

The same checkpoint table also stores a Workspace customer-scoped scan. Each bounded page queues
current person reconciliation for exactly one verified, linked Google identity, including former
members; unverified and ambiguous links are excluded. Checkpoints contain only the customer ID,
person-ID cursor, scan times and a short lease. Generation initialization, outbox insertion and
cursor advancement are one D1 batch, so a failed page cannot be skipped and an expired scan cannot
overwrite its successor. Scans repeat hourly after completion. Queue coverage does not prove that
Google access has converged. Migration 0027 has not been applied in production.

### Google customer quota pauses (0028)

`provider_backoffs` now accepts the Workspace provider and stores its customer ID in the generic
provider-context column. The migration preserves existing Discord application deadlines. A Google
rate-limit response pauses that customer's runner across restarts; shorter later responses cannot
reduce the saved deadline. Migration 0028 has not been applied in production.

`provider_access_intents` now accepts Google as well as Discord. The upgrade preserves outstanding
Discord intents, their opaque person-key references and identity foreign keys. Remote changes are
prepared under a current account lease and full canonical snapshot, then audited only after a
validated provider read. Access observations and receipts use the same conditional-write guard so a
superseded request cannot overwrite newer membership or failure state. Hosted migration and provider
acceptance remain separate requirements.
