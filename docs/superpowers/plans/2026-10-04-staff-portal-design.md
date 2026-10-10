# Staff portal design

## Purpose and approved outcome

LVBT staff need one working place to see members, follow up with new people, correct records and
manage committee assignments. The user approved a separate staff application, LVBT Google account
linking, shared membership records, administrator and committee permissions, and screens for People,
welcome follow-up, corrections and duplicate review, committees, access, paper sign-up and export.
Implementation remains in this chat on an isolated website branch.

The authoritative scope is this approved design and its implementation plan. The website repository
owns the runtime. This design does not introduce a website CMS or change the membership definition.

## Verified starting point

The implementation starts from website `main` at `bc3013c28a605511f513684823f6975cfdea8ad7`. The
canonical checkout contains unrelated joining and prototype changes; they remain untouched. The
isolated branch is `codex/staff-portal`.

Production joining and member accounts are deployed. A read-only production query on October 4 found
11 non-deleted person records marked `member`, with Beehiiv identities but no Workspace or Discord
identities. That count does not prove the historical roster has been imported. There are no
staff-administrator, committee-assignment, welcome-claim or access-audit tables. The staff hostname
does not resolve, and the verified LVBT Cloudflare account returns no Access applications or
identity providers and no staff Worker. Existing person search, consent handling and SQLite tests
are reusable.

The production website Worker already lists secret bindings for Google OAuth, Access audience and
team domain, Google Admin, Beehiiv and platform signing. Only their names and types were inspected;
their values and provider validity are not proven. The preview website Worker lists none of those
secret bindings. Verify the existing setup and reuse confirmed organization credentials through
maintainer bootstrap before proposing replacement clients or keys. Secret-binding presence does not
establish that a staff application, an Access policy or a working sign-in flow exists.

## Architecture and identity

Build a separate Astro application at `staff.lasvegasfortransit.org`, rendered on request by a
Cloudflare Worker. Keep the functioning public site deployment intact while adding the staff app.
Public endpoints retain their existing paths and behavior. Use the existing Astro, Tailwind,
TypeScript and repository-tooling versions; pin the Cloudflare adapter compatible with that Astro
release. Node is 24.20 or newer within the 24.x line; pnpm is 11.25.0.

Extract the domain rules and person storage used by both applications into private workspace
packages. Keep domain rules independent of network calls. Share integrations when both applications
need them; do not copy platform code or make the applications call an internal HTTP API. There is
one canonical migration sequence and one production D1 database, `lvbt-platform`, bound as
`PLATFORM_DB`. Previews use `lvbt-platform-preview` and never query the production roster.

Protect the whole staff hostname with Cloudflare Access using the approved LVBT Workspace Google
Group, `console-users@lasvegasfortransit.org`, with a 12-hour Access session. Verify the Access JWT
signature, issuer, application audience and expiry inside the Worker as well as at the edge. Resolve
the signed-in account to its verified `google_workspace` identity; do not interpret the Access
subject as a Google OAuth subject. Every request obtains current permissions from the database.
Membership of the Workspace domain never grants administrator permissions.

Complete the existing public-site Google authorization-code flow with PKCE, a single-use state and
verified Google ID token. Require the LVBT hosted domain and a verified email. An unlinked account
confirms its existing personal member email with the current one-time-code machinery. LVBT issues
Workspace accounts only to team members who are already LVBT members. Linking never creates a person
or consent. Refuse linking and staff access without an active membership, and recheck membership on
every protected request. Staff sessions last 12 hours. Preview callbacks use the fixed approved
callback host and a server-validated LVBT deployment allowlist.

Use the existing `LVBT_GOOGLE_OAUTH_CLIENT_ID`, `LVBT_GOOGLE_OAUTH_CLIENT_SECRET`,
`LVBT_ACCESS_TEAM_DOMAIN` and `LVBT_ACCESS_AUD` names. Reconcile older `PLATFORM_*` placeholders
with the actual configuration registry. Missing configuration fails closed. The first administrator
is the president's verified, linked person record, initialized by an explicit, audited maintainer
bootstrap operation. Do not embed a production person ID in a migration or grant administrator
access to the first visitor. Later administrator changes require the corresponding permission and
cannot remove the last administrator.

## Member management and interfaces

Use the existing permission matrix for member, volunteer, committee lead and staff administrator.
Administrators can search all non-deleted people. Committee leads can search and view only their
current committees' people; target authorization applies before returning counts, search results,
history or exports. Denials never reveal whether a hidden or deleted record exists. Donation history
requires `donations.view`. Role changes take effect on the next request.

Welcome work has separate `welcome.view`, `welcome.claim` and `welcome.complete` permissions. An
administrator can welcome any eligible member. A committee lead can welcome a new member whose
recorded interests match their committee's administrator-configured interest mapping, without
gaining `person.view` permission for the full person record. Committee settings use the existing
join-interest identifiers; an empty mapping grants no additional welcome access. Claims never
override the viewer's current authorization, and a lead who loses access cannot retain claimed
contact details. This separation resolves the existing tasks' different scope rules for welcome work
and full person records.

Deliver the following existing routes as complete server-rendered screens, using the shared message
catalog and established LVBT application patterns:

- `/people`: one main name/email search, expandable membership/committee/ZIP filters, including
  members with no committee yet. Administrators have direct All members / No committee yet links.
  Rows prioritize name, email and current committees; show a membership column when viewing mixed
  statuses and a small linked-Discord note only when an account is linked. Avoid repeating the same
  membership or missing-account label down the default member list. Use 25 results per cursor page.
  A linked account does not establish server role state.
- `/people/<id>`: prioritize membership, Discord account linkage, contact and current committee
  assignments, with native forms to add, change role or end an assignment. Put consent evidence,
  other account references, past committees and engagement history in expandable sections; 50 events
  per history page. Merged IDs redirect to the survivor after the viewer is authorized to see it.
  Record views are audited with IDs and time, retained for one year.
- `/people/<id>/edit`, `/review` and `/review/<id>`: attributed corrections with a required reason,
  duplicate comparison, merge, keep separate and undo. Corrections preserve field ownership and
  appear in history and exports. Merge and unmerge preserve related records and recompute roles.
- `/welcome` and `/welcome/<id>`: unwelcomed members who joined in the last 60 days, overdue people
  first. Claim and release are atomic, concurrent claims cannot both succeed, and seven-day claims
  expire. Queue rows contain no email or phone. Only the claimant sees the follow-up contact details
  and stated signup interests. The claimant can add a willing member directly to a committee they
  manage, using the existing assignment service, with current member/claim/interest authorization
  checked in the transaction. This does not expose unrelated committee information, mark the person
  welcomed, or confirm provider roles. Welcoming records method, note and actor as a `welcomed`
  event.
- `/committees` and committee detail pages: the existing nine committees, current and past
  assignments, settings and authorized assignment changes. There is at most one current assignment
  per person and committee. Failed integration hooks remain queued for retry without reversing an
  accepted assignment change. Administrators maintain description, time commitment, acceptance of
  new assignments, welcome-interest mapping and account connections. Pausing new assignments keeps
  current people and access. Versioned forms prevent stale settings from overwriting newer changes;
  retained historical mappings allow cleanup after a connection changes or is cleared.
- `/access`: actual connected-account, committee and external-access state, with the existing
  access-audit history and recovery actions. Unknown or unavailable provider state is labeled
  explicitly. Removing access updates the authoritative assignment so reconciliation cannot restore
  it unintentionally. Confirmations expire within five minutes and must match the current member,
  stable account, mapped resource, provider context, generation and desired access. A completed
  update is distinct from a confirmed provider read. Keep this recovery view secondary to Members,
  Welcome and Committees. Leads can read their members' server-member role and their own committee
  access/history; retry and removal controls are administrator-only. Provider adapters/configuration
  remain in Task 12. Preserve the existing Google and Discord integration dependencies.
- `/paper` and `/paper/sheet`: the existing five-row entry form and 12-row letter-size sheet.
  Preserve entered rows when adding rows without JavaScript. Idempotent batches record paper consent
  only for a consented row and record attendance with its source and sheet wording version.
- `/export`: administrator-only POST download of the existing specified ZIP containing people,
  consents, identities, engagement CSV files, equivalent JSON and README. Exclude deleted people,
  preserve consent evidence, make spreadsheet output safe and audit each export. Use the Pacific
  date in the filename; export 5,000 people within 30 seconds on preview.

Protected state changes use POST with same-origin and single-use form protection. Actor identity
comes from the verified request, never from submitted fields. Repeat submissions do not duplicate
claims, assignments, paper batches or external operations. Every success and failure state has
working server-rendered navigation and useful feedback. Primary navigation uses Members, Welcome and
Committees. Keep duplicate administration, access recovery, export and paper intake in secondary
navigation for authorized staff as those screens ship. Do not publish placeholder actions or links
to screens that have not shipped.

Design for nontechnical nonprofit staff. Use a compact single-line LVBT staff identity and task
navigation, with a quiet divider and small page headings. Keep the established LVBT colors and
typeface. Explain contact permissions, member activity and duplicate checks in everyday language;
put account references, form versions and detail provenance behind expandable details.

The roster must answer whether someone is a member and help staff take the next useful step. Show
membership on mixed-status results; the current-members list needs no repeated status column. Order
the roster by displayed name, link members without a committee directly to assignment, and show
eligible welcome work with its current owner. Opening and editing a profile preserves the original
search, filters and page. Direct roster assignments return there; full-profile changes stay on the
profile with that return link. Routine integration queue messages belong in account recovery;
committee screens surface account failures only when staff can take action.

## Data completeness, recurring work and rollout

Preserve the current rule: active newsletter consent means `member`; withdrawn consent means
`former_member`; absent consent means `not_member`. Import and reconcile historical Beehiiv and
Notion intake records through the existing import task, with dry-run review and consent provenance.
Do not count event attendance, an intake Discord username or server presence as membership or
verified account ownership. Reconcile the complete roster before claiming the portal lists all LVBT
members. Maintain two-way Beehiiv consent synchronization and durable provider retries.

Use the existing job-runner design for claim expiry, audit retention, synchronization and queued
integration retries. Persist enough operation identity to retry safely and re-read current
eligibility before granting access. Deployment and preflight cover the staff Worker, job runner,
Access policy, hostname, shared migrations and required bindings. Production secrets remain
maintainer-managed; an agent never sets or rotates them.

Ship through the repository's required pull-request and validation workflow. Production and preview
have separate configuration and data. Every staff response, including errors and redirects, is
private and non-cacheable, sends `X-Robots-Tag: noindex, nofollow`, and uses a restrictive CSP. The
Worker refuses invalid Access tokens even on alternate deployment URLs. Staff pages work without
JavaScript and stay within the 35 KB gzip JavaScript budget.

Retain Notion follow-up during preparation. Switch new intake to the welcome queue only after the
queue works in production, reconcile existing unwelcomed members, then add the retirement note and
make the old intake read-only. Keep the old records. Deployment rollback must not lose claims,
welcomes or consent changes or create duplicate follow-up work.

## Verification and completion

Run `pnpm check` after each change and keep existing public-site checks passing. Test expired,
tampered, wrong-issuer and wrong-audience tokens; absent identity links; forbidden domains; replayed
OAuth state; duplicate linking races; administrator bootstrap and last-administrator protection.
Test the full permission matrix, cross-committee search and detail access, deleted records and
hidden donation history. Exercise every mutating route's authorization and form protections.

Use SQLite-backed domain tests for current assignments, concurrent claims, correction attribution,
merge and undo, paper idempotency, consent withdrawal, retention and retry failure recovery. Browser
tests exercise production-built screens with JavaScript disabled, keyboard navigation, 320-pixel
layouts, accessible errors and meaningful populated states. Verify preview search latency below one
second for 5,000 synthetic people and the existing three-second slow-network content budget.

The existing tasks require prototype sessions with three staff or volunteers, including an
assistive-technology user. Record real sessions and fix blockers before treating their prototype or
usability criteria as complete. Physical VoiceOver and specified phone acceptance need actual device
evidence; emulation does not fulfill them.

Live acceptance proves the president can authenticate, link the correct person and use administrator
screens, while a committee lead is limited to their own people and an unapproved account is refused.
The existing launch task additionally requires three staff to use production for a week, the Notion
handover, the first week's new members welcomed or claimed, recorded keyboard and screen-reader
review, the console group below 45 members, and a president's Go comment. Keep those gates open
until evidence exists. The welcome feature's first-month service metric remains its own tracked
follow-up; code or deployment cannot prove it.

## Implementation status and approval

Track implementation milestones against this plan. Add work only for uncovered deliverables, with
explicit acceptance evidence. Record implementation, provider readiness and human acceptance
separately; do not mark the portal complete while a required child or live gate remains open.

The user approved the design outline and this written specification on October 4. The implementation
plan is maintained alongside this design. The chosen execution method is implementation in this
chat, preserving the isolated checkout and unrelated work.

## Technical references

- [Astro Cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
