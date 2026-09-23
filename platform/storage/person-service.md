# Person service

The person service is the only way platform code reads and writes people. It lives in `person-service.ts` beside this page. It is ordinary shared code, not a web API: the website and, later, the staff console call it directly. Every write goes through it so the same rules apply everywhere:

- A source may only change the fields it owns (table below). A write that tries to change another field ignores that field and logs a warning.
- Every changed field records its source in `field_sources`.
- Consent is only recorded when the incoming data carries evidence of it, and membership status is recomputed after every consent change.
- Reads never return deleted people.

## Functions (version 1)

| Function                                                                      | What it does                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPerson(id)`                                                               | One person, or nothing if they don't exist or were deleted.                                                                                                                                                                         |
| `findByEmail(email)`                                                          | The person with that email address, compared lowercased.                                                                                                                                                                            |
| `findPeople({ text, email, membershipStatus, zip, regionId, limit, cursor })` | A page of people matching every filter given, with a cursor for the next page.                                                                                                                                                      |
| `upsertFromSource({ source, fields, consent })`                               | Finds the person by email or creates them, applies the fields the source owns, and records the consent. Returns the person and whether they were `linked` or `created`. A repeat never overwrites a field that already has a value. |
| `updateFields(id, { source, fields })`                                        | Changes the fields the source owns.                                                                                                                                                                                                 |
| `recordConsent(id, { scope, source, method, wordingVersion, givenAt })`       | Records consent, unless an active one for that scope exists, and recomputes membership.                                                                                                                                             |
| `withdrawConsent(id, { scope, source, withdrawnAt })`                         | Withdraws active consent for the scope and recomputes membership.                                                                                                                                                                   |
| `recordEngagement(id, { type, occurredAt, source, reference, details })`      | Adds an engagement event.                                                                                                                                                                                                           |
| `linkIdentity(id, { platform, externalId, externalEmail, linkMethod })`       | Links an account on another platform.                                                                                                                                                                                               |
| `setRegion(id, regionId, source)`                                             | Sets the region when the source outranks the current one: `staff`, then `address`, `member_choice`, `zip`. A member's own choice or address replaces a staff value.                                                                 |
| `deletePerson(id)`                                                            | Clears every personal field now and sets the deletion time.                                                                                                                                                                         |

## Field ownership

| Field                                                       | Sources that may change it                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `given_name`, `family_name`                                 | `join_form`, `google_form`, `member`, `staff`, `paper`, `import`          |
| `email`                                                     | `join_form`, `newsletter_box`, `google_form`, `member`, `staff`, `import` |
| `phone`                                                     | `join_form`, `google_form`, `member`, `staff`, `paper`, `import`          |
| `zip`, `census_block`, `census_block_vintage`, `place_name` | `join_form`, `member`, `staff`                                            |
| `preferred_language`                                        | `member`, `staff`                                                         |

## Changelog

- **Version 1** (2026-09-23): the functions above. Matching is by normalized email address only; the review queue for near-matches arrives with identity matching.
