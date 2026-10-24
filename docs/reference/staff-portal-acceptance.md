# Staff portal acceptance

The maintainer leading launch uses this checklist to decide whether the staff portal is ready for
real work. It covers the deployed application, outside services, and staff experience; keep release
receipts and test results in the private acceptance record or the build system.

Start with [the protected preview setup guide](../guides/set-up-staff-preview.md). The
[operations reference](./staff-portal-operations.md) explains configuration checks, release
selection, and recovery.

## Before you start

Choose a reviewed release and an explicitly named environment. Use approved test memberships and
accounts, including an administrator, a committee lead, and an unapproved account. The person
running the session needs permission to inspect the relevant provider settings. Obtain approval
before a test changes a real account, permission, or membership.

For every scenario below, record the environment, tester, observed behavior, and a concise result.
Link detailed evidence from the private acceptance record. Mark a scenario unverified when its
provider, device, user, or evidence is unavailable. Keep contact details, credentials, verification
codes, and private task content out of public evidence.

## 1. Verify the deployed release and access boundary

1. Check the selected saved build and its deployment receipt. Confirm both staff and jobs are
   serving the recorded versions and the expected database.
2. Open the staff hostname while signed out. Confirm Cloudflare Access requires authentication.
3. Open it with an approved staff account, then with an unapproved account. Confirm only the
   approved account can pass the Access gate.
4. Check direct staff asset requests and alternate hostnames. Confirm they cannot bypass the gate.
5. Confirm the jobs Worker has no public route, custom domain, direct `workers.dev` address, or
   preview URL. In setup mode, confirm schedules and provider writes remain disabled.
6. Rehearse application recovery against the current schema using the documented saved-artifact
   procedure. Preserve accepted member activity and pending cleanup work.

Success means the intended release is reachable through the protected hostname and the alternative
paths remain closed. Record application activation separately from staff and provider acceptance.

## 2. Verify membership linking and staff permissions

1. Sign in with the approved administrator's organization account through the selected mode. Access
   mode must continue without a second Google sign-in; direct Google mode must work with Access
   absent. Complete membership confirmation in that browser if requested. Confirm it links the
   intended active member record.
2. For first-time setup, complete **Set up staff access** once. Confirm the designation is audited
   and cannot replace an existing administrator. Remove the temporary setup secret after success.
3. Open **Members**, search by name and email, and open the intended profile. Confirm membership,
   contact information, committees, and accounts belong to that person.
4. Sign in as a committee lead. Confirm the lead can work with assigned members and cannot read or
   edit another committee's restricted records.
5. Use a test member assigned to multiple committees. Confirm each assignment appears independently
   and ending one assignment leaves the others intact.
6. Try an unapproved account and an inactive test membership. Confirm access is refused without
   creating a person, consent, or administrator permission.
7. Expire a confirmation attempt and request a fresh code. Confirm recovery is understandable and
   older unused codes cannot complete the new attempt.

Success means each account reaches only the records and actions authorized for it. A Google domain
or staff Google-group membership alone does not establish a portal administrator designation.

## 3. Reconcile the actual member roster

1. Review the authoritative membership sources privately. Separate affirmative consent evidence from
   form submissions, newsletter delivery status, and incomplete historical records.
2. Run the read-only roster preview and compare totals, duplicate candidates, source identifiers,
   and original consent times with the source records.
3. Resolve ambiguous rows through the approved review process. Preserve staff corrections and later
   withdrawals; do not substitute import time for missing evidence.
4. Obtain authorization for the reviewed apply operation. Verify the resulting member records and
   totals, then repeat the operation to confirm it creates no duplicates.

Success means the accepted roster is complete for the reviewed evidence and unresolved rows remain
explicitly reviewable. Keep the source roster and row-level findings private.

## 4. Verify each provider with approved live test accounts

Use an isolated Discord server and separate preview Google groups. Newsletter tests require an
approved isolated publication or a verified equivalent event source. Confirm the actual account
supports the needed integration before enabling it.

For each configured provider:

1. Record a permitted membership or committee change in the portal.
2. Inspect the provider independently and confirm the intended access or subscription changed.
3. Change it back and confirm removal or withdrawal with a fresh provider read.
4. Interrupt the provider or exercise its supported rate-limit test. Confirm the member's choice
   remains saved and the next eligible retry completes it.
5. Make a newer change while an older request is pending. Confirm the newer choice wins and stale
   work cannot restore withdrawn access or consent.
6. Repeat the job without changing anything. Confirm it adds no duplicate membership events or
   provider changes.

Discord additionally needs these checks: optional joining from member onboarding, server-rule
acceptance, multiple committee roles, account disconnection, and a server member with LVBT roles but
no linked member record. Disconnection must preserve server membership and unrelated roles. An
unlinked account is flagged for staff review; its roles remain unchanged.

For Google, verify direct and inherited group access separately. A failed removal or continuing
inherited access must remain unresolved. Google sign-in does not prove group administration works.

For newsletter consent, verify both directions, replay, ordering, and unsubscribe ties. Original
subscription creation time and delivery-check time do not prove when a later choice happened.
Delayed echoes of the platform's own writes must not manufacture fresh consent. Delivery pauses must
not change membership.

Success requires independent checks in the outside service, recovery after failures, and removal of
access for every enabled integration. Local fixtures establish code behavior and remain separate
evidence.

## 5. Observe staff completing real tasks

Run at least three staff or volunteer sessions, including a phone session and assistive technology.
Use [the usability-test guide](../guides/run-a-usability-test.md) to recruit, observe, and record
findings. Have participants find a member, update an allowed detail, assign multiple committees,
claim a welcome, and understand what needs attention without explaining the interface to them.

Review the welcome queue, member search, and member profile with a keyboard and screen reader.
Confirm clear focus, readable labels, useful errors, and no horizontal overflow at phone widths.
Resolve blocking findings and repeat the affected task with its participant.

## 6. Complete production acceptance

Before production changes, verify the backup and migration plan, the approved release, provider
configuration, and launch authorization. The setup preview workflow does not promote staff or jobs
to production.

For launch acceptance, confirm all of the following:

- The required staff workflows and provider scenarios have passed.
- At least three staff members have used production for a week, including once on a phone.
- New-member follow-up has moved from Notion to the welcome queue; the old intake has its retirement
  note and receives no new pages.
- Every new member from the first production week has been welcomed or claimed.
- The keyboard and screen-reader review is recorded with its actual devices and outcomes.
- The console-users group has fewer than 45 members.
- The president has explicitly approved launch in the private launch record.

Keep these results in the acceptance record, with concise outstanding blockers. Update the relevant
work states and acceptance checkboxes; keep setup instructions useful for the next operator.
