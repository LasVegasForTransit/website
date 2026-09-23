# Person service

The person service is the only way platform code reads and writes people. It lives in `person-service.ts` beside this page, with the field ownership rules in `field-ownership.ts`. It is ordinary shared code, not a web API: the website and, later, the staff console call it directly. Every write goes through it so the same rules apply everywhere:

- A source may only change the fields it owns (table below). A write that tries to change another field ignores that field and logs a warning.
- Every changed field records its source in `field_sources`.
- Consent is only recorded when the incoming data carries evidence of it, and membership status is recomputed after every consent change.
- Reads never return deleted people.

## Functions (version 1)

| Function                                                                      | What it does                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPerson(id)`                                                               | One person, or nothing if they don't exist or were deleted.                                                                                                                                                                                                                                                                   |
| `findByEmail(email)`                                                          | The person with that email address, compared lowercased.                                                                                                                                                                                                                                                                      |
| `findPeople({ text, email, membershipStatus, zip, regionId, limit, cursor })` | A page of people matching every filter given, with a cursor for the next page.                                                                                                                                                                                                                                                |
| `upsertFromSource({ source, fields, emailVerified, identity, consent })`      | Finds the person the record belongs to using the matching rules below, or creates them. Then applies the fields the source owns and records the consent. Returns the person and whether they were `linked`, `created`, or `created_and_queued` for staff review. An existing person's filled-in fields are never overwritten. |
| `updateFields(id, { source, fields, allowClear })`                            | Changes the fields the source owns. Empty values are skipped unless `allowClear` is set, as when a member removes their phone number.                                                                                                                                                                                         |
| `recordConsent(id, { scope, source, method, wordingVersion, givenAt })`       | Records consent, unless an active one for that scope exists, and recomputes membership.                                                                                                                                                                                                                                       |
| `withdrawConsent(id, { scope, source, withdrawnAt })`                         | Withdraws active consent for the scope and recomputes membership.                                                                                                                                                                                                                                                             |
| `recordEngagement(id, { type, occurredAt, source, reference, details })`      | Adds an engagement event.                                                                                                                                                                                                                                                                                                     |
| `linkIdentity(id, { platform, externalId, externalEmail, linkMethod })`       | Links an account on another platform.                                                                                                                                                                                                                                                                                         |
| `setRegion(id, regionId, source)`                                             | Sets the region when the source outranks the current one: `staff`, then `address`, `member_choice`, `zip`. A member's own choice or address replaces a staff value.                                                                                                                                                           |
| `deletePerson(id)`                                                            | Clears every personal field now, sets the deletion time, ends every session and voids any sign-in code.                                                                                                                                                                                                                       |

## Field ownership

| Field                                                | Sources that may change it                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `given_name`, `family_name`                          | `join_form`, `google_form`, `external_form`, `member`, `staff`, `paper`, `import`          |
| `email`                                              | `join_form`, `newsletter_box`, `google_form`, `external_form`, `member`, `staff`, `import` |
| `phone`                                              | `join_form`, `google_form`, `external_form`, `member`, `staff`, `paper`, `import`          |
| `zip`                                                | `join_form`, `google_form`, `external_form`, `member`, `staff`                             |
| `census_block`, `census_block_vintage`, `place_name` | `join_form`, `member`, `staff`                                                             |
| `preferred_language`                                 | `member`, `staff`                                                                          |

## Matching

Every record that reaches `upsertFromSource` goes through the matching rules in `matching.ts`. They decide whether it belongs to someone LVBT already knows, is someone new, or needs a staff member to decide. The rules run in order, and the first that applies decides.

| Rule | Condition                                                                               | Result             | Link method or review reason |
| ---- | --------------------------------------------------------------------------------------- | ------------------ | ---------------------------- |
| 1    | The record's platform account is already linked to a person                             | That person        | (unchanged)                  |
| 2    | Same normalized email as one person, and either side is verified                        | That person        | `verified_email`             |
| 2a   | Same normalized email, neither verified, and the person typed it into a form themselves | That person        | `self_linked`                |
| 3    | Same normalized email, neither verified, from any other source                          | New person, queued | `same email, unverified`     |
| 4a   | Same phone number                                                                       | New person, queued | `same phone`                 |
| 4b   | Same first name, last name and ZIP code                                                 | New person, queued | `same name and ZIP code`     |
| 5    | None of the above                                                                       | New person         | `created_by_platform`        |

Emails are normalized by trimming spaces and lowercasing only. Dots and plus signs are kept, because "j.doe" and "jdoe" can be two different people. A verified email is one the person has shown they control: they signed in with an emailed code, confirmed a double opt-in, or signed in with Google.

Rule 2a is the one addition to the plan's rules. The join form, the newsletter box and outside intake forms are filled in by the person themselves, and they show nothing about an existing record back. Treating a repeat join as a stranger would make a duplicate member and a review item every time someone joined twice. Emails that came from someone else, such as a paper sign-in sheet, an import or staff entry, still get rule 3. In rule 3 the new person is stored without the email, since another person already has it, and the review item keeps the email in its details.

Two existing people are never combined automatically. Linking only ever attaches a new record to someone who exists, and combining two records goes through the review queue and a staff decision. The same pair is queued once per reason, and never again for that reason once staff have kept them separate.

## Changelog

- **Version 1** (2026-09-23): the functions above, with the matching rules and review queue. `upsertFromSource` takes an optional `emailVerified` and `identity`, and can return `created_and_queued`.
