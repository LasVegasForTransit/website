# Staff Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. The user selected native execution in this chat. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Give LVBT staff a working, protected portal for its complete membership roster, personal
welcomes, corrections, committee assignments, access management, paper intake and export.

**Architecture:** A separate Astro application runs on a Cloudflare Worker, sharing domain, storage
and integration packages with the functioning public site. Cloudflare Access authenticates staff;
verified Workspace identities and current database permissions authorize every operation. A shared
outbox and scheduled Worker reconcile providers and perform retention without losing accepted
writes.

**Tech Stack:** Astro 7.2.10, Cloudflare adapter 14.2.0, Tailwind 4.3.3, TypeScript 6.0.3, Wrangler
4.127.1, D1/SQLite, Node 24.20+, pnpm 11.25.0, node:test and Playwright.

**Spec:** [Approved staff portal design](./2026-10-04-staff-portal-design.md).

## Global Constraints

- Production hostname: `staff.lasvegasfortransit.org`; Access group:
  `console-users@lasvegasfortransit.org`; Access and staff sessions: 12 hours.
- Production D1: `lvbt-platform`; binding: `PLATFORM_DB`; preview D1: `lvbt-platform-preview`.
- Every request reads current permissions; Workspace-domain membership never grants administrator
  permissions. Invalid Access assertions fail closed on alternate deployment URLs too.
- Keep the functioning public site deployment intact. Public endpoints retain their existing paths
  and behavior. One canonical migration sequence serves both applications.
- Preserve active-newsletter-consent membership rules and consent evidence. Attendance, Discord
  usernames and server presence do not prove membership or account ownership.
- Use existing `LVBT_*` credential names. Agents never set or rotate production secrets. Existing
  secret-binding names do not prove provider validity or authorize creating replacement keys.
- All staff responses, including errors and redirects, are private and non-cacheable, send
  `X-Robots-Tag: noindex, nofollow`, and use a restrictive CSP.
- Staff pages work without JavaScript and stay within the 35 KB gzip JavaScript budget.
- People pages contain 25 results; engagement pages contain 50 events. Welcome eligibility spans 60
  days; overdue starts at seven days; claims expire after seven days.
- Record-view audits retain one year; access-change audits retain three years.
- Run `pnpm check` after every change. Use the organization's existing tooling configuration; never
  edit `.lvbt/web-platform/` by hand.
- Preserve unrelated work. No commits until explicitly authorized; when authorized, stage explicit
  paths and commit in one `git restore --staged . && git add <paths> && git commit -F <file>` chain.
- Keep prototype sessions, device evidence, provider readiness and production acceptance open until
  actually observed. Deployment is not launch acceptance.

## Review Focus

- A person with no given name remains searchable by email, and literal `%` or `_` does not broaden a
  search. Task 5 tests null fields and escaped search terms.
- A lead loses a committee or interest mapping while a welcome claim is active: their next request
  cannot expose contact details. Task 6 tests revocation during claims.
- A delayed provider grant races with withdrawal, deletion or reassignment: retries reread current
  eligibility and cannot restore obsolete access. Tasks 3 and 12 test stale grants.
- Merge undo follows later edits and newly attached records: undo restores only recorded movements
  and cannot silently erase newer work. Task 7 tests post-merge mutations.
- A preview callback receives an arbitrary host or a repeated state: neither can receive credentials
  or create a session. Task 2 tests redirect allowlists and callback replay.

## File structure and shared contracts

Create three private packages, each with package scripts for lint, type checking and tests using the
existing organization packages:

- `packages/platform-core/src/`: current pure `apps/site/platform/core/` modules, shared message
  catalog, `permissions.ts` and workflow input/result types.
- `packages/platform-storage/src/`: current storage modules plus authentication, committees,
  permissions loading, welcome, corrections, merge, audits, forms and outbox services.
  `packages/platform-storage/migrations/` owns existing migrations 0001–0008 and all subsequent SQL.
- `packages/platform-integrations/src/`: current integration clients plus Google token verification,
  Workspace access, provider reconciliation and export encoding. Domain functions never fetch.

Create `apps/staff/` with `astro.config.mjs`, `wrangler.jsonc`, `package.json`, `tsconfig.json`,
organization ESLint configuration, `src/middleware.ts`, `src/environment.ts`,
`src/layouts/StaffLayout.astro`, `src/components/`, `src/pages/`, `src/lib/`, `tests/` and
`playwright.config.ts`. Create `apps/jobs/` with its own Worker configuration, `src/index.ts` and
tests. Keep site orchestration in `apps/site/platform/`; update its imports to package exports
rather than copying implementations.

Shared types are exported from `packages/platform-core/src/staff-types.ts`:

```ts
type Actor = { personId: string; roles: Role[]; leadCommitteeIds: string[] };
type Role = 'member' | 'volunteer' | 'committee_lead' | 'staff_admin';
type Page<T> = { items: T[]; nextCursor: string | null };
type MutationResult<T> =
  { kind: 'ok'; value: T } | { kind: 'forbidden' | 'conflict' | 'invalid' | 'not_found' };
// Confirmed reads are distinct from queued or failed update attempts.
type ProviderState = 'granted' | 'absent' | 'unknown';
```

Reuse the existing `Db`, `Statement`, `SqlValue`, `Person`, `PersonFields`, `PeopleQuery`,
`ConsentScope`, `MembershipStatus` and authentication result types. Each task defines its own
exported workflow types alongside its service. Route code turns denied or hidden targets into the
same non-disclosing response. No submitted actor ID is trusted.

## Scope and sequence

The immediate outcome is an administrator viewing the complete membership roster, followed by
verified Discord membership and role synchronization. Establish identity linking, current
permissions and a protected staff entry before the roster. The Discord bot, managed-role registry,
and verified account linking must be ready before server access can be reconciled. Then complete
durable role reconciliation and validate it against a real server. Keep human, provider and release
gates open while independent implementation continues. Continue the remaining workflows in their
numbered task order, without expanding edge cases ahead of these outcomes.

## Execution steps

Every task ends with its focused tests and `pnpm check`. Record implementation results and remaining
acceptance evidence in the project work log. Commit steps are deferred until explicit user
authorization; use the mandatory contribution skill and repository helper for an authorized PR.

### Task 1: Share the existing person platform without changing public behavior

**Files:** Create the three packages above and `packages/platform-storage/tests/support/db.ts`; move
existing pure/storage/integration files into them. Modify site platform imports, existing test
imports, `apps/site/tests/support/platform-db.ts`, `apps/site/wrangler.jsonc`, package manifests and
the lockfile. Keep the original public routes.

**Interfaces:** Packages export the existing public signatures unchanged, including `PersonService`,
`Db`, `membershipStatus` and `createSession/readSession`. Canonical migrations move to
`packages/platform-storage/migrations/`; each consuming Worker points there.

- [x] Add `packages/platform-storage/tests/migrations.test.ts`: assert all eight existing migrations
      apply and a second migration run leaves membership rule version 1 and existing data unchanged.
- [x] Run `pnpm --filter @lasvegasfortransit/platform-storage test`; expect failure before the
      package and migration helper exist.
- [x] Extract packages, update explicit exports and consuming imports, and keep site endpoint bodies
      unchanged. Reuse shared SQLite support rather than a second schema definition.
- [x] Run package tests, `pnpm --filter @lasvegasfortransit/site test`, and `pnpm check`; require
      all existing public account, joining and consent scenarios to pass.

### Task 2: Verify Workspace sign-in and link the correct person

**Files:** Create `packages/platform-integrations/src/google-identity.ts`,
`packages/platform-storage/src/workspace-link.ts`, migration `0009_workspace_sign_in.sql`, and
`apps/site/functions/sign-in/google/index.ts`, `google/callback/index.ts`, `link-account/index.ts`.
Modify `apps/site/platform/sign-in.ts`, `auth.ts`'s relocated implementation and messages. Add
`packages/platform-storage/tests/workspace-link.test.ts` and site Google route tests.

**Interfaces:** `verifyGoogleIdToken(token, {clientId, now, fetch})` returns verified
`{subject,email,givenName,familyName}` or throws.
`beginWorkspaceSignIn(db, {returnTo,callbackUrl,now})` returns `{state,verifier,challenge}`;
`consumeWorkspaceState(db,state,now)` returns stored state once.
`linkWorkspaceIdentity(db, {workspace,personId,method,operationId})` returns
`MutationResult<{personId:string}>`. `WorkspaceLinkService` binds verified pending Workspace
identity to a separately purposed one-time personal-email code; it never accepts a browser-supplied
Google subject. Existing 12-hour staff sessions remain the session contract.

- [x] Add assertions that bad signature/audience/issuer/expiry, wrong `hd`, unverified email and
      repeated state create no identity/session; personal sign-in codes cannot be used for linking.
      Test two concurrent links to different people: one succeeds, the other reports conflict.
- [x] Run focused node tests; expect missing verifier/linker failures before implementation.
- [x] Implement Google code exchange with PKCE and scopes `openid email profile`, verified token
      claims, expiring server-side state and a fixed callback allowlist. Harden identity linking's
      existing silent conflict into an explicit result. Use existing email delivery and rate limits.
- [x] Implement returning-user sign-in and first-time confirmation of an existing member email.
      Workspace accounts belong only to existing LVBT members. Linking creates no person or consent;
      active membership is required for linking, session creation and every protected session read.
- [ ] Implement and verify the administrator-confirmed linking flow with the same membership and
      conflict rules.
- [x] Run focused tests and `pnpm check`; exercise arbitrary preview hosts, normalized personal
      emails, cancelled Google consent and replay in local compiled tests.
- [ ] Record the three real volunteer prototype sessions, including assistive technology; tests do
      not satisfy this human acceptance item.

### Task 3: Persist committees, current permissions and durable assignment changes

**Files:** Create core `staff-types.ts`, `permissions.ts`; storage `committees.ts`,
`staff-roles.ts`, `outbox.ts`, `audits.ts`; migration `0010_staff_authorization.sql`; and
corresponding storage tests.

**Interfaces:** `loadActor(db,personId): Promise<Actor|null>` derives roles from current records.
`can(actor,permission,target?): boolean` and `requirePermission(...)` implement the permission
matrix. `CommitteeService(db).assign({personId,committeeId,role,actorId,operationId})`,
`.changeRole(assignmentId,role,actorId,operationId)` and
`.endAssignment(assignmentId,reason,actorId,operationId)` return `MutationResult<Assignment>`.
`enqueueOperation(db,{id,kind,personId,targetId,generation,payload})` persists an idempotent outbox
row. Types `Assignment`, `Permission` and `PermissionTarget` are exported with their defining
modules.

- [x] Add table-driven allowed/denied assertions for every permission cell, including own records,
      unrelated committees and admin-only donation/merge/export/administrator management. Assert
      last-admin removal and domain-only auto-admin are refused.
- [x] Add SQLite assertions for nine named seeds, one current assignment, preserved ended
      assignments and exactly one `role_changed` event/outbox operation on retried writes. Run
      tests; expect failures before schema and services exist.
- [x] Implement database constraints, current-role loading and the matrix. Add separate welcome
      permissions and committee interest mappings using existing join-interest IDs. Bootstrap uses
      an explicit verified president identity, with an audited operation rather than a hardcoded
      person ID.
- [x] Implement assignment changes and outbox writes atomically. A provider failure cannot undo the
      accepted change. `staffAdminManage(db,actor,{targetPersonId,enabled,operationId})` protects
      the last administrator inside the database mutation, including concurrent removals.
- [x] Run focused tests and `pnpm check`; test that a newer assignment generation invalidates an
      older queued grant and that deleted people yield no actor.

### Task 4: Serve a protected staff application and real navigation

**Files:** Create the staff application files listed above, `src/lib/access.ts`, `context.ts`,
`forms.ts`, `responses.ts`, initial `/index.astro`, `/sign-out.ts`, and `tests/access.test.ts`,
`forms.test.ts`, `route-authorization.test.ts`. Create migration `0011_staff_workflows.sql` for
single-use form tokens, workflow idempotency and record-view audits.

**Interfaces:**
`verifyAccessAssertion(request,env,now): Promise<{email:string,subject:string}|null>` validates JWKS
signature, exact configured issuer, audience and expiry. `resolveStaffContext(...)` returns
`{actor,db,requestId}` only for a matching verified Workspace email identity; Access `sub` is not
the Google subject. `issueFormToken(db,actor,action,now)` and
`consumeFormToken(db,actor,action,token,now)` bind a one-use token to the actor/action.
`privateResponse(response)` applies the private headers on every middleware outcome.

- [x] Test signed local fixtures for absent/tampered/expired/wrong-issuer/wrong-audience tokens,
      missing identity, removed roles and alternate hosts. Assert privacy headers on success,
      denial, redirects and exceptions. Run the failing tests.
- [x] Configure SSR with pinned Cloudflare adapter 14.2.0, shared database bindings and middleware.
      Access-only linked staff without `console.enter` receive a non-disclosing denial. An unlinked
      account gets a safe link-account destination, never a roster response.
- [x] Implement single-use forms, exact same-origin POST checks and replay feedback. Test spoofed
      actor fields, missing Origin, cross-origin POST and a removed role with an unused form token.
- [x] Build the shell and progressive server-rendered feedback with shared messages and skip links.
      Add navigation entries only as their actual screens ship in subsequent tasks.
- [x] Run staff tests, production build and `pnpm check`. No remote Access setup is claimed here.

### Task 5: Search people and show complete authorized history

**Files:** Modify storage `people-search.ts`; create `staff-people.ts`, `record-views.ts`,
`apps/staff/src/pages/people/index.astro`, `[id]/index.astro`, and staff people tests.

**Interfaces:** `searchStaffPeople(db,actor,query): Promise<Page<Person>>` accepts existing query
fields plus `committeeId`; authorized predicates apply in SQL before limit/count. Default limit
is 25. `getStaffPerson(db,actor,personId,{cursor?})` returns authorized profile, consents,
identities, current/past assignments and `Page<EngagementEvent>` of 50 events, or null.
`recordPersonView` records actor/person IDs and time only.

- [x] Test name/email/ZIP/status/committee combinations, cursor pages with duplicate display names,
      null given names, literal wildcard characters, deleted people and cross-committee targets. Run
      focused tests; expect the missing scoped search and profile failures.
- [x] Implement scoped SQL search, validated cursors, history pagination and conditional donation
      projection. Authorize a merged-ID survivor before redirecting. Never render hidden-field
      values into HTML or client data.
- [x] Build the two no-JavaScript screens with preserved filters, empty/error states and audited
      profile reads. Local compiled-worker search over 5,000 synthetic people remains below one
      second (latest recorded result: 96 ms).
- [ ] Measure protected remote-preview search latency below one second and verify the hosted
      screens.
- [x] Run storage/staff tests, browser tests with JavaScript disabled, and `pnpm check`.

Local compiled-Worker search over 5,000 synthetic members: 26 ms; native forms verified with
JavaScript disabled at 1440 and 320 pixels. The protected remote-preview latency gate above remains
open.

Further local usability verification: the roster orders displayed names with stable tie pagination
and an email fallback for unnamed records. Opening, editing, cancelling, saving and changing
committees preserve the original filtered roster. A direct roster assignment returns to that list;
ordinary profile changes keep the profile open. The current-members list omits its redundant status
column while broad verification searches retain explicit membership on each result.

Member verification search now includes former members and other authorized records when looking up
a name or email. The initial directory still lists current members, and explicit membership,
committee and ZIP filters remain effective. Mixed results show membership status. An empty filtered
result offers a link to include other membership statuses while preserving the other filters. The
compiled Worker browser verified a withdrawn member can be found by email and identified as a former
member, without exposing that record to a committee lead outside their current scope. The extra
list-tab row was replaced with a contextual link beside the page title; unused space below the
search controls was removed. This is local verification; it does not close the remote-preview or
actual Discord synchronization gates.

Utility revision: every roster result shows membership, members without committees link directly to
assignment, and eligible welcome work shows its current claimant. Successful assignments return to
the same filtered roster. Ordinary lookups keep additional filters collapsed. Committee screens show
actionable access failures instead of routine queue messages. The existing welcome eligibility and
authorization rules supply these links; this does not introduce a second follow-up system.

### Task 6: Run an atomic welcome queue

**Files:** Create storage `welcome.ts`, core welcome types, staff `/welcome/index.astro`,
`/welcome/[id].astro`, `/welcome/[id]/claim.ts`, `release.ts`, `complete.ts`, and welcome tests.

**Interfaces:** `WelcomeService(db).list(actor,{cursor?,now})` returns contact-free queue rows;
`.claim(actor,personId,{operationId,now})`, `.release(...)` and
`.complete(actor,personId, {method,note,operationId,now})` return `MutationResult<WelcomeClaim>`.
`.contact(actor,personId,now)` returns contact only for the current authorized claimant.
`WelcomeClaim` exposes IDs and expiry; contact data is a separate return type.

- [x] Test the exact 60-day boundary, seven-day overdue ordering/expiry and two competing claims.
      Assert no contact in queue results and no contact after lead removal or interest-mapping
      removal, even with an active claim. Test repeated completion produces one attributed
      `welcomed` event.
- [x] Run failing tests; implement atomic conditional claim writes and authorization on each action
      and contact read, using the current interest mapping and current membership status.
- [x] Build queue, claim/release and method/note completion screens with actual POST forms. Contact
      retrieval never broadens `person.view`; link the full profile only when that permission
      exists.
- [x] Run focused tests, no-JavaScript concurrent browser sessions and `pnpm check`.

Local utility follow-through: claimed welcomes show signup interests and allow a willing member to
join one of the claimant's managed committees without changing screens. The assignment transaction
checks current membership, current interest scope and an unexpired owned claim. Direct administrator
All members / No committee yet views make assignment follow-up accessible without opening filters.
Default member rows omit repeated membership and missing-account labels; mixed-status searches still
show membership explicitly. Real provider synchronization remains Tasks 9 and 12.

### Task 7: Attribute corrections and safely merge or undo duplicates

**Files:** Create storage `corrections.ts`, `merges.ts`, migration
`0012_corrections_and_merges.sql`, staff `/people/[id]/edit.astro`, `/review/index.astro`,
`/review/[id].astro`, mutation endpoints and corrections/merge tests.

**Interfaces:** `correctPerson(db,actor,personId,{fields,reason,operationId})` returns
`MutationResult<Person>`. `mergePeople(db,actor,{survivorId,mergedId,reason,operationId})` returns
`MutationResult<{mergeId:string}>`; `undoMerge(db,actor,{mergeId,reason,operationId})` returns the
same result type. Each merge records exact moved-row IDs and before values, not a blanket reversal.

- [x] Test empty reasons, field ownership, actor attribution and repeated submissions. Test merge
      with all related rows, conflicting identities/emails/current assignments and consent
      withdrawal; nothing is partially moved on conflict.
- [x] Test undo after new edits, welcomes and identities: restore recorded movements only, preserve
      later unrelated records, and return conflict for incompatible later changes. Run failing
      tests.
- [x] Implement atomic correction history and merge bookkeeping, survivor resolution and membership
      recomputation. Invalidate affected sessions/claims when required by resulting authorization;
      enqueue provider reconciliation for both people without reviving obsolete identities.
- [x] Build comparison, keep-separate, correction and undo forms. Run focused tests, browser flows
      and `pnpm check`. Workspace linking never creates records or duplicate reviews.

Local Task 7 acceptance: corrections, comparison, keep-separate, combine and undo are implemented.
SQLite-backed tests cover exact movements, immutable content, email/account/assignment conflicts,
current authority and snapshot races, rollback, replay, later edits/activities/accounts/assignment
changes, withdrawal preservation, removed/replaced identities, copied-email restoration and
administrator access. The native compiled-Worker browser suite verifies combination, undo, lead
denial and a conflicting-email form that retains the reason without partially changing either entry.
The full repository check passes. This is local implementation evidence; provider jobs remain
pending. Local tests do not satisfy live acceptance criteria; record those separately when verified.

### Task 8: Manage committee assignments and settings

User priority: make onboarding useful before further administrative screens. First expose assignment
from the member profile and a roster filter for members who have no committee. Keep membership,
contact and current committees visible; collapse account references, consent evidence and history.

- [x] Implement native profile assignment, role change and ending an assignment through Task 3's
      atomic service, actor-bound one-use forms and current permissions. Show current account update
      queue state without inferring provider success. Verify attributed writes and cross-committee
      lead denial in the compiled Worker browser with JavaScript disabled.
- [x] Show current committee and Discord account linkage in roster rows, add “No committee yet”
      filtering, and keep secondary profile records expandable. Test scoped roster reads and stale
      actors. This is local implementation; live provider acceptance remains open.

**Files:** Create staff `/committees/index.astro`, `/committees/[id].astro`,
settings/assignment/role/end POST endpoints, committee components and browser tests. Consume Task
3's service.

**Interfaces:** `getCommitteeView(db,actor,committeeId)` returns authorized current/past assignments
and settings; `updateCommitteeSettings(db,actor,committeeId,{...input,expectedVersion,operationId})`
updates description, time commitment, acceptance of new assignments, provider identifiers and
existing interest-ID mappings. Pausing preserves current people and access; ending assignments is
the explicit removal action. Keep historical account mappings so later reconciliation can remove
superseded access, and queue current work atomically when connections change.

- [x] Test that leads see only their committees and cannot edit settings; admins can see all nine.
      Assert counts exclude deleted people and ended assignments, and invalid interest IDs are
      refused.
- [x] Run failing tests; implement list/detail queries and all server forms using current permission
      checks and Task 3's atomic mutation contracts.
- [x] Render provider retry feedback accurately. A successful assignment can show pending external
      access; do not display a provider success before it occurs.
- [x] Run focused tests, no-JavaScript assignment/role/end flows and `pnpm check`.

Local Task 8 acceptance: authorized rosters, settings, profile assignment/role/end forms, stale
settings conflicts and accurate pending/failed feedback pass in the compiled Worker with JavaScript
disabled. Live provider and deployment acceptance remains in Tasks 12–14 and is not claimed here.

### Task 9: Show actual access and recover failures without regranting removals

**Files:** Create storage `access-view.ts`; staff `/access/index.astro`, access mutation endpoints,
audit components and tests. Consume outbox/audits and Task 12's provider interface.

**Interfaces:** `listAccess(db,actor,query): Promise<Page<AccessRow>>` combines canonical
identities, assignments, last observed provider state and queued operations. `AccessRow` records
observation time and `ProviderState`. `requestAccessRetry(db,actor,operationId)` requeues current
eligible work; `removeAssignedAccess(db,actor,{assignmentId,reason,operationId})` ends the
authoritative assignment. Provider access types live in core `access.ts`; observations are tied to
current account IDs/email, the server/domain context, mapped resource, assignment generation and
expected access. A confirmation expires within five minutes. Missing runtime configuration remains
unknown; Task 12 supplies configured adapters and refreshes expired observations before claiming
live success. Pending or failed jobs are displayed independently from provider confirmations.

- [x] Test missing provider configuration, timed-out reads and stale observations render unknown
      rather than granted. Test cross-committee history denial and admin-only recovery actions.
- [x] Run failing tests; implement rows and audit queries, and permission-protected retry/removal.
      Removal uses the assignment service so the next reconciliation cannot restore it.
- [x] Render actual connected accounts, committee roles, provider observations and three-year audit
      history with accurate pending/failed/unknown feedback.
- [x] Run tests, browser recovery flows and `pnpm check`.

Local Task 9 evidence: the compiled, no-JavaScript Worker browser passes current-authority
retries/removals, generation fencing, preserved removals, scoped history, account ambiguity,
changing mappings/context/membership, observation expiry and unconfigured-state handling. The
configured compiled Worker renders an actual adapter-confirmed Discord Member role and removal. A
subsequent bounded provider timeout expires that proof and renders “Server role not confirmed.”
Confirmed Discord changes appear in the administrator's member profile and the permission-scoped
account history. Deleted records are anonymous and absent from committee-lead history. Desktop and
320px mobile browser checks pass without horizontal overflow. Other pending provider work is
displayed separately from the completed Discord change.

These are local fixture results. No live provider acceptance is claimed. Task 12 still requires
complete provider orchestration, live Discord proof, Google and mailing-list reconciliation. Tasks
10 and 11 remain required before launch; this ordering prioritizes the user's server membership and
contributor onboarding needs.

### Task 10: Enter paper signups and print a usable sheet

**Files:** Create storage `paper-intake.ts`, staff `/paper/index.astro`, `/paper/sheet.astro`,
`/paper/submit.ts`, print styles and paper tests.

**Interfaces:** `importPaperBatch(db,actor,{batchId,eventId,wordingVersion,rows})` returns
`MutationResult<{personIds:string[],reviewIds:string[]}>`; each row has contact fields and explicit
`newsletterConsent` boolean. Reuse matching, field ownership and consent machinery.

- [x] Test five initial rows, add-row preservation without JavaScript, blank and invalid rows,
      consenting versus nonconsenting rows, attendance provenance and batch replay. Run failing
      tests.
- [x] Implement atomic idempotent intake, per-row errors preserving entered values, and consent
      evidence using the actual sheet wording version. Attendance does not grant membership.
- [x] Render the 12-row US-letter sheet and entry form. Verify printed labels and sufficient writing
      space through a rendered print artifact, plus keyboard and 320-pixel browser checks.
- [x] Run focused tests and `pnpm check`.

Local Task 10 evidence: storage tests cover atomic batch rollback, replay, consent versus
attendance, ambiguous matches, within-batch phone reviews and permission/email ownership races.
Calendar tests cover future dates, UTC midnight and both daylight-saving transitions. Real failing
withdrawal tests exposed the UTC-day comparison and missing held-signup feedback before their fixes.
The compiled HTTPS Worker with JavaScript disabled passes entry preservation, per-row errors,
expired forms, creator-only receipts, truthful held-signup feedback, keyboard and 320-pixel checks.
The generated PDF was inspected: one US-letter page, twelve rows and clear labels/writing space.
Full `pnpm check` passes all 30 tasks. General staff and scheduled-job native suites pass against
canonical migration 0023. No production migration, provider delivery, physical-printer or human
usability claim. The issue is not closed while native MCP authorization and broader acceptance
remain unavailable.

### Task 11: Export all authorized data and run retention jobs

**Files:** Create integrations `export-archive.ts`, storage `full-export.ts`, `retention.ts`, staff
`/export/index.astro`, `/export/download.ts`, jobs `src/index.ts`, `src/run-jobs.ts`, configurations
and export/retention tests. Share migrations with both existing apps.

**Interfaces:** `exportPeople(db,actor,{now}): Promise<Response>` streams the administrator-only
ZIP. `runMaintenance(db,{now,limit})` expires welcome claims, removes record-view audits older than
one year and access-change audits older than three years, and applies the existing
deletion-retention policy. `runScheduledJobs(env,scheduledTime)` invokes bounded maintenance and
Task 12 reconciliation.

- [x] Assert exact ZIP files `people.csv`, `consent_records.csv`, `identities.csv`,
      `engagement_events.csv`, `export.json`, `README.txt`; equivalent JSON/CSV, deleted exclusion,
      consent evidence and spreadsheet-formula escaping. Leads cannot download. Run failing tests.
- [x] Implement the Worker-compatible archive, attributed audit, local-date filename, merge-aware
      retention, erasure of archived personal snapshots, withdrawal ownership retention and
      irreversible undo behavior. The implementation uses the pinned Worker-compatible encoder.
- [x] Test retention cutoffs, active-person history, expired-claim races, bounded repeat
      maintenance, rollback and privacy-safe metrics in storage and compiled local Worker suites.
- [x] Run `pnpm check`, build the staff/jobs Workers and export 5,005 synthetic people through the
      compiled local Worker; the measured local run is under 30 seconds and the ZIP was
      independently checked.
- [ ] Measure export and retention against the protected remote preview within 30 seconds.
- [ ] Prove large connected-component Worker budgets, retire operational identity keys only after
      provider cleanup is confirmed, and define/verify retention of unresolved provider intents.

Partial local Task 11 progress: migration 0022 and `runMaintenance` protect both audit tables from
updates and deletion outside a bounded maintenance batch. The batch creates and removes its
validated clock/cutoff scope atomically, removes record views older than one calendar year and staff
audits older than three, and expires current welcome-claim deadlines. Tests cover just before, at
and after cutoffs, leap-day normalization, limits, repeat execution, renewed claims, rollback and
recent-record protection. The compiled scheduled Worker removes 105 old records across two ticks,
retains recent records, rejects direct deletion and leaves no deletion scope, even with Discord sync
disabled and no external provider calls. Current member and engagement records remain.

Task 11 remains incomplete: hosted export acceptance, physical deleted-record retention, legacy
erasure backfill and withdrawal ownership cleanup still require implementation and acceptance.
Explicit deletion of current profiles and associated merge/correction snapshots is implemented
locally in migration0024; this does not complete physical retention or provider cleanup retention.
Retention of old unconfirmed provider intents is also unresolved. The broad retention checkbox stays
open until those policies and races are proved. Migration 0022 has not been applied to production.

Local export implementation: administrator download page, one-use form, current SQL scope and
post-snapshot permission checks, atomic request audit and browser-compatible streaming ZIP are
implemented. The exact six files contain equivalent primary CSV/JSON records, consent evidence and
formula-safe spreadsheet values. JSON retains original data and field/committee/withdrawal/
correction/profile records. Credentials and OAuth/session state are excluded. Tests first failed for
missing archive/page/profile data; implementation then passed archive, stale/forged actor,
revocation-before-transaction, audit-failure and profile tests. The compiled Worker downloaded 5,005
synthetic people with 5,005 consent rows in 253 ms. Python zipfile independently checked every CRC
and compared all four CSV tables with JSON. Full pnpm check: 30/30; general native staff suite also
passes. Pinned fflate 0.8.3 browser entry verified from official repository and installed through
this repository's catalog. Hosted preview timing, deletion/merge retention and pending provider
intent retention remain open. This task is not Done.

### Task 12: Reconcile membership and committee access with real providers

**Files:** Create integrations `beehiiv-sync.ts`, `google-groups.ts`, `discord-access.ts`, storage
`provider-sync.ts`, jobs reconciliation tests and `apps/site/scripts/platform/import-roster.ts`.
Modify existing join/withdraw/delete orchestration to enqueue current-state reconciliation.

**Interfaces:** `ProviderAdapter.observe(person,target): Promise<ProviderState>` and
`.apply({operationId,person,target,desired}): Promise<ProviderResult>`; `ProviderResult` records
observed state and retry timing. `GoogleTokenSource.getToken(scopes): Promise<string>` is injected
from an organization-approved credential source; never create a service-account key as fallback.
`reconcilePending(db,adapters,{now,limit})` reloads eligibility/generation immediately before
applying an operation and conditionally saves the result. `previewRosterImport(records)` produces
counts and conflict/provenance report; `applyRosterImport(db,records,{runId})` is repeat-safe.

Merge reconciliation uses current `person` generations for both entries. An archived target has a
cleanup job bound to its active merge ID and survivor ID; undo advances both generations. The runner
must resolve current identity ownership before applying any change, so cleanup for the archived ID
cannot remove access that the same linked account now holds through the survivor. Test delayed merge
cleanup after undo and withdrawal, and provider failure receipts against newer generations.

- [ ] Implement and test Beehiiv webhook/poll replay, provider pagination, partial failures, 429
      retry timing, consent withdrawal and stale-success races; Beehiiv currently has no two-way
      sync.
- [ ] Implement Beehiiv two-way consent synchronization with source evidence timestamps and durable
      checkpoints. Unclear historical consent remains unresolved; do not fabricate consent.
- [x] Implement local verified-identity Google Group and Discord role adapters, current plus
      retained mappings, readback observations, retries and local compiled fixtures. Unrelated roles
      are preserved and missing setup fails closed.
- [ ] Wire both providers into the hosted jobs runtime and prove preview read/write/retry/revocation
      with approved test identities; no live provider acceptance is claimed by local fixtures.
- [ ] Integrate the approved keyless Google Workload Identity Federation token source after
      verifying current IAM/Workspace policy. Do not create a service-account key or substitute a
      token broker.
- [x] Implement the normalized private roster preview and repeat-safe consent apply with provenance;
      the CLI was exercised on synthetic data and emits no contact data.
- [ ] Locate and review the actual Beehiiv/Notion source, resolve duplicates and consent provenance,
      reconcile totals, then perform the authorized dry-run and apply. No suitable source roster has
      been found in Drive.
- [x] Run provider contract tests with synthetic records and `pnpm check` locally.
- [ ] Complete end-to-end preview provider tests after maintainer setup and the verified token
      source.

Local Discord progress in Task 12: the pinned REST adapter reads and validates stable server
accounts, changes only managed roles, preserves unrelated roles and confirms changes with a server
read. It bounds both fetch and body-read timeouts, honors fractional retry timing and waits for
member screening before grants. Canonical plans include membership, current identity ownership,
assignment generations and all retained mappings, including multiple retired roles and cleared
connections. Database leases serialize account jobs across workers, and expired workers cannot save
stale grants over newer failures. Discord display data is stored separately from LVBT contact
fields; erasing the identity also erases its Discord snapshot. Successful Discord receipts leave the
shared job incomplete until other providers are proven. Equal-time observations prefer the later
database append; email-inferred Discord identities cannot carry verified role proof.

Verified account linking now includes member-session-bound one-use browser authorization, the actual
confidential OAuth exchange, stable-account ownership checks and a compact member connection page.
It requests only account identity, stores no OAuth tokens, preserves membership/contact data, and
atomically replaces outdated person and committee reconciliation work. Personal downloads and
deletion cover the new profile snapshots. Contract tests cover expiry, conflicting accounts,
withdrawal/sign-out during verification, generation replacement and full transaction rollback.

Native verification uses `pnpm -C apps/site test:discord-link` after the completed repository build.
It runs the compiled website Worker with HTTPS, canonical migrations and a JavaScript-disabled
browser, routes authorization to an isolated local Discord fixture, then exchanges the code through
the actual handler and stores the verified identity. Strict start-origin, one-use callback,
withdrawn-member denial and signed-out redirect checks pass. The staff native suite also passes all
existing roster, welcome, assignment, correction, merge and recovery flows after migration 0016. The
compiled runtime exposed unsupported edge redirect handling; the transport now uses manual
redirects, rejects all redirects and binds the default global fetch receiver. Neither fixture
constitutes live Discord server acceptance.

The scheduled jobs Worker now processes bounded pending Discord work once a minute. Persisted
application pauses survive a new dispatcher, and never-confirmed accounts precede expired receipts.
Consent transitions recompute membership and enqueue current person/committee work atomically;
withdrawal and rejoining rollback and generation replacement are covered. The compiled scheduled
runtime verifies grants and automatic removal after an actual consent withdrawal, preserving an
unrelated role. This is isolated fixture evidence.

Periodic scans now revisit live verified linked accounts, including former members and accounts
whose earlier jobs finished. Server-specific leased checkpoints resume pages of up to 100 people
across scheduled invocations, then become due at the next UTC hour. Queue writes retain canonical
generations, reuse current pending work and preserve deferred retries. Transaction tests cover 5,000
accounts without skipped or duplicate jobs, rollback, server isolation, expired-worker takeover and
withdrawal during selection. The compiled scheduled Worker repairs a missing Member role on a
completed account and removes roles externally restored to a former member, preserving unrelated
roles. Fixture-only job completion simulates other providers; it does not prove their orchestration.

The dispatcher still attempts up to 25 accounts per minute within its time budget. Local scan
coverage does not prove live hourly convergence for 5,000 accounts or inventory of unlinked server
users. Those capacity and coverage gates, complete merge/provider orchestration, full Google/mail
orchestration, maintainer release configuration and live bot/server proof remain open. No Task 12
acceptance item is closed on this partial result.

The configured compiled staff Worker additionally renders an actual adapter-confirmed Member role,
immediately hides that stale confirmation on withdrawal, and shows confirmed removal after another
provider read. It receives public server/role configuration without bot credentials. Both staff and
jobs ship with synchronization disabled; their public runtime values and unresolved release setup
are documented in the canonical registry. These are local fixture results, not live acceptance.

Ordinary deletion now atomically supersedes earlier grants and queues current cleanup bound to the
original deletion timestamp. The retained verified Discord identity supplies role removal, while
erased profiles and access confirmations stay erased. Failed enqueueing rolls back deletion;
provider denial retains a retry. Migration 0020 also queues previously deleted ordinary accounts and
clears their old confirmations, excluding active merges. Its upgrade test covers both cases. The
compiled scheduler verifies actual deletion cleanup after a Member rejoins, preserving an unrelated
role. Contract tests reject mismatched deletion bindings and ownership changes before or during
provider reads. Merge/undo tests retain the survivor's access, invalidate delayed old jobs, and
remove managed roles after subsequent withdrawal. Archived entries without an account remain
excluded from Discord selection; shared provider completion and live acceptance remain open.

Confirmed Discord access changes now use the shared staff audit log. Migration 0021 adds bounded
pre-write intents guarded by the current account, lease, role mapping and generation. Only a
validated server read produces a grant/removal entry; unchanged roles create no entry. A write that
actually applied before timing out can be confirmed on a later invocation. Partial role changes are
recorded independently, and intent/audit failures preserve safe retry behavior. Tests cover those
cases, replay, later drift and stale withdrawal. The compiled scheduled Worker confirms grants and
deletion removals; the configured staff browser renders the same history on administrator member
profiles and the scoped account-updates page. It identifies the automatic update, reason and staff
requester when known, without storing provider bodies, credentials or contact fields.

This is partial evidence for access-audit work, not its completion. A common writer across Google,
GitHub, onboarding and the full action set, and real preview provider changes remain open. Migration
0022 now protects deletion outside the atomic retention job, and controlled-clock three-year audit
purging passes cutoff, rollback and native scheduled D1 tests. Migrations 0019–0022 have not been
applied to production. Task 12 remains incomplete.

### Task 13: Prepare protected preview and the production release

**Files:** Modify `.github/workflows/ci.yml`, add staff/jobs deployment workflows, update deployment
scripts and `apps/site/scripts/bootstrap/config/platform-secrets.ts`; add
`docs/reference/staff-portal-operations.md`, staff bootstrap/preflight scripts and release tests.

**Interfaces:** `preflightStaff(environment)` reports each app/domain/Access/database/credential
requirement without secret values. `bootstrapStaffAdmin(db,{workspaceSubject,operationId})` requires
the explicit verified president link and records the designation. Release artifacts identify source
SHA, migration version and staff/jobs Worker versions.

- [x] Test independent site/staff/jobs builds, canonical migration paths, separated preview
      bindings, Access checks on alternate URLs, and release source identity. Run failing tests.
- [x] Update configuration registry from future placeholders to current runtime requirements.
      Correct the existing staff group/session setup drift to `console-users@lasvegasfortransit.org`
      and 12 hours. Existing Google/Access binding names are retained; secret validity is checked
      through maintainer bootstrap, without exposing values or silently replacing clients.
- [ ] Prepare preview Access policy and fixed Google callback host/allowlist; obtain working test
      identities through approved maintainer setup. Verify admin, lead and unapproved-account
      outcomes.
- [ ] Prepare migration backup/application order and release rollback. Reverting the app keeps new
      claims/events/consents and does not re-enable obsolete follow-up. Public promotion remains
      separate.
- [x] Run local `pnpm check`, `pnpm build`, staff/jobs dry-run bundles and compiled browser/release
      artifact tests. The fresh preflight still reports remote configuration as unverified.
- [ ] Complete protected-preview smoke/browser tests and prepare a reviewed release from current
      `main`; do not commit or perform production-secret operations without their existing
      authorization and maintainer setup.

### Task 14: Prove usability, hand over intake and finish launch tracking

**Files:** Create `docs/reference/staff-portal-acceptance.md`; update operations instructions and
existing work items with evidence. No unit test can replace these human/provider gates.

**Interfaces:** The acceptance record names source SHA, deployed URLs, tester/date, scenario,
observed result, remaining issue and linked evidence; it contains no member contact details.

- [x] Build and locally exercise synthetic prototypes for sign-in/link, People, welcome,
      correction/review, committees, access and paper flows. These remain local prototypes, not a
      deployed portal.
- [ ] Record at least three real staff/volunteer sessions, including an assistive-technology user;
      fix blockers and document their outcomes.
- [x] Run the compiled protected routes with JavaScript disabled and 320-pixel layouts.
- [ ] Verify keyboard-only navigation, the 35 KB gzip JavaScript budget and three-second
      slow-network content budget; record actual VoiceOver and specified-phone evidence.
- [ ] Verify real president linking/admin access, a current committee lead's restricted access,
      unapproved-account refusal, provider retry/revocation and complete imported roster on
      production.
- [ ] Move new follow-up to the working welcome queue, reconcile existing unwelcomed members, retain
      the old Notion records, and make old intake read-only with the retirement note.
- [ ] Record three staff using production for a week, all that week's new members welcomed or
      claimed, keyboard/screen-reader acceptance, fewer than 45 console-group members and the
      president's Go comment. Keep the first-month seven-day median welcome metric as its existing
      follow-up.
- [ ] Keep the project work log current, add work only for genuinely uncovered deliverables, and
      mark implementation complete only when its acceptance evidence is recorded. Report observed
      defects through the approved repository workflow; don't duplicate existing work or claim
      unverified changes succeeded.

## Ordering and review

Execute Task 1, then the foundations in Tasks 2–4. Task 14's prototype sessions precede production
workflow implementation for Tasks 2 and 5–10; prepare clearly labeled synthetic prototypes once the
plan is approved and record the required human evidence. Tasks 5–10 consume the foundations; Task 11
provides scheduled execution; Task 12 supplies actual external state; Task 13 releases the complete
system; Task 14 proves the existing launch criteria. Provider setup can proceed alongside local
work, without bypassing its identity or secret requirements.

Self-review confirms all specification sections map to the tasks above: identity and architecture
(1–4, 13), every requested screen (5–11), roster completeness/provider retries (12), privacy and
retention (4, 11), and actual usability/production acceptance (13–14). The five Review Focus cases
have explicit owning tests. Native execution is preserved. The user approved this plan on October 4;
native implementation is underway.
