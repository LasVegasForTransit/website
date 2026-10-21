# Person service

Contributors use the person service to read and change member and contact records. Use this
reference when you add an intake source or change how the website and staff app handle people. The
service is shared code in `person-service.ts`, not a web endpoint.

Every write must follow the same rules:

- Each source may change only the fields it owns. The service ignores other fields and logs a
  warning.
- `field_sources` records where each changed field came from.
- Consent requires evidence. The service recalculates membership after each consent change.
- Reads never return deleted people.

Choose the read function based on what the caller needs:

- Use `getPerson(id, { withCounts })` for navigation. It follows merged records to the surviving
  person, including a chain of merges. Counts belong to that person. A read without counts uses one
  database statement.
- Use `getExactPerson(id)` for sessions, signed links and permission checks. It returns only that
  active record. A session or removal link for an old record must not gain authority over the
  surviving person. Signed email removal checks the exact active person again during deletion.
- Use `findPeople(...)` to list current active people.

Writes require the current active person's identifier. They do not follow merge links, so a form
opened before a merge cannot change the surviving record by mistake.

For combining and splitting records, see
[Combine duplicate member records](../../../docs/guides/combine-member-records.md).

## Functions (version 1)

| Function                                                                       | What it does                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPerson(id, { withCounts })`                                                | Reads the current person, following merges. Optionally calculates engagement counts.                                                                                                                            |
| `findByEmail(email)`                                                           | Finds the person by lowercased email.                                                                                                                                                                           |
| `getExactPerson(id)`                                                           | Reads only this active record. Use for session, token and mutation permission checks.                                                                                                                           |
| `findPeople({ text, email, membershipStatus, zip, regionId, limit, cursor })`  | Returns people matching every supplied filter and a cursor for the next page.                                                                                                                                   |
| `upsertFromSource({ source, fields, emailVerified, identity, consent })`       | Finds or creates a person, applies source-owned fields and records consent. Returns `linked`, `created` or `created_and_queued`. Preserves existing filled-in fields.                                           |
| `updateFields(id, { source, fields, allowClear })`                             | Changes source-owned fields. Skips empty values unless `allowClear` permits clearing them.                                                                                                                      |
| `recordConsent(id, { scope, source, method, wordingVersion, givenAt, renew })` | Records evidence and recalculates membership. Ordinary intake reuses an active preference; an explicit account checkbox can renew it with separate evidence. A withdrawal wins over older or same-time consent. |
| `recordImportedNewsletterConsent(id, evidence)`                                | Records historical consent with its provider identity, original time and import run. Repeated imports are safe. Conflicts and unresolved duplicates require staff review.                                       |
| `withdrawConsent(id, { scope, source, withdrawnAt })`                          | Withdraws consent for this scope and recalculates membership.                                                                                                                                                   |
| `recordEngagement(id, { type, occurredAt, source, reference, details })`       | Records an activity once for the same person, type, source and reference.                                                                                                                                       |
| `linkIdentity(id, { platform, externalId, externalEmail, linkMethod })`        | Links the person's account on another platform.                                                                                                                                                                 |
| `setRegion(id, regionId, source)`                                              | Applies the region-source rules described below.                                                                                                                                                                |
| `deletePerson(id)`                                                             | Clears personal fields immediately, records deletion, ends sessions and invalidates sign-in codes.                                                                                                              |

Region sources normally rank `staff`, `address`, `member_choice`, then `zip`. An address or the
member's own choice can replace a staff value. For example, `allowClear` lets a member remove a
phone number; an empty imported phone value must not erase it.

## Field ownership

| Field                                                | Sources that may change it                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `given_name`, `family_name`                          | `join_form`, `google_form`, `external_form`, `member`, `staff`, `paper`, `import`                   |
| `email`                                              | `join_form`, `newsletter_box`, `google_form`, `external_form`, `member`, `staff`, `paper`, `import` |
| `phone`                                              | `join_form`, `google_form`, `external_form`, `member`, `staff`, `paper`, `import`                   |
| `zip`                                                | `join_form`, `google_form`, `external_form`, `member`, `staff`                                      |
| `census_block`, `census_block_vintage`, `place_name` | `join_form`, `member`, `staff`                                                                      |
| `preferred_language`                                 | `member`, `staff`                                                                                   |

## Matching

Every record that reaches `upsertFromSource` goes through the matching rules in `matching.ts`. They
decide whether it belongs to someone LVBT already knows, is someone new, or needs a staff member to
decide. The rules run in order, and the first that applies decides.

| Rule | Condition                                                                               | Result             | Link method or review reason |
| ---- | --------------------------------------------------------------------------------------- | ------------------ | ---------------------------- |
| 1    | The record's platform account is already linked to a person                             | That person        | (unchanged)                  |
| 2    | Same normalized email as one person, and either side is verified                        | That person        | `verified_email`             |
| 2a   | Same normalized email, neither verified, and the person typed it into a form themselves | That person        | `self_linked`                |
| 3    | Same normalized email, neither verified, from any other source                          | New person, queued | `same email, unverified`     |
| 4a   | Same phone number                                                                       | New person, queued | `same phone`                 |
| 4b   | Same first name, last name and ZIP code                                                 | New person, queued | `same name and ZIP code`     |
| 5    | None of the above                                                                       | New person         | `created_by_platform`        |

Emails are normalized by trimming spaces and lowercasing only. Dots and plus signs are kept, because
"j.doe" and "jdoe" can be two different people. A verified email is one the person has shown they
control: they signed in with an emailed code, confirmed a double opt-in, or signed in with Google.

Rule 2a applies to the join form, newsletter box and outside intake forms that people fill in
themselves. These forms reveal no existing record information. Treating a repeat join as a stranger
would make a duplicate member and a review item every time someone joined twice. Emails that came
from someone else, such as a paper sign-in sheet, an import or staff entry, still get rule 3. In
rule 3 the new person is stored without the email, since another person already has it, and the
review item keeps the email in its details.

Two existing people are never combined automatically. Linking only ever attaches a new record to
someone who exists, and combining two records goes through the review queue and a staff decision.
The same pair is queued once per reason, and never again for that reason once staff have kept them
separate.

### Historical imports

Historical imports retain the provider identity, original consent times and private import run. A
newer local withdrawal blocks an older active provider snapshot. An imported withdrawal affects only
older active consent.

The importer saves a new person, source-owned fields, identity and review items together. If the
response is lost, a retry finds that identity rather than creating another person. Before saving
historical consent, the transaction checks the exact active identity, unresolved duplicate reviews
on either side and newer withdrawals again.

The one-time roster importer passes `holdUnverifiedEmail` to `upsertFromSource`. An unverified email
match then returns a hold result before creating a second profile. The importer saves the source for
administrator review. This option neither changes ordinary matching nor links an uncertain account
automatically.

## Engagement log

The engagement log is the one place where things a person did are recorded, as events that callers
can add but cannot edit. Each event has a type, when it happened, the source that reported it, and
optional details. When it happened can be earlier than when it was recorded, as with a paper sign-in
sheet entered the next day, and both times are kept. Newsletter consent being given or withdrawn is
logged automatically as `subscribed` or `unsubscribed`.

An event can't be changed or deleted on its own. Deletion erases personal event details immediately.
The retention job removes the remaining events when it removes the deleted profile. An event
recorded against the wrong person is fixed by adding a `correction` event whose reference is the
mistaken event's ID, and the counts then leave the mistaken event out.

The event types are `subscribed`, `unsubscribed`, `joined`, `form_response`, `welcomed`, `rsvp`,
`attended`, `donated`, `volunteer_shift`, `role_changed`, `check_in_held`, `correction` and
`duplicate_reviewed`. A form response without newsletter consent uses `form_response`; it does not
record an LVBT join. Adding a type is a code change in `engagement.ts`.

Other features read these counts instead of keeping their own tallies. They are worked out from the
log whenever they are asked for:

| Count                   | Meaning                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `first_attended_at`     | When the person first attended an event                      |
| `last_attended_at`      | When they last attended                                      |
| `attended_last_90_days` | How many events they attended in the last 90 days            |
| `attended_total`        | How many events they have attended                           |
| `last_engaged_at`       | Their most recent event of any kind                          |
| `member_since`          | The start of their current, unbroken newsletter subscription |

## Changelog

- **Version 1** (2026-09-23): the functions above, with the matching rules and review queue.
  `upsertFromSource` takes an optional `emailVerified` and `identity`, and can return
  `created_and_queued`. `getPerson` can return engagement counts.
