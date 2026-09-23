# Platform database schema

This page describes every table and column in the Organizing Platform's database, in one plain sentence each. The database is Cloudflare D1 (see the [glossary](../../../docs/reference/glossary.md#d1)). The numbered `.sql` files beside this page are the migrations that build it; running them in order on an empty database creates everything below.

No table stores a street address. Location is a ZIP code and a census block only.

## Apply the migrations

```sh
pnpm exec wrangler d1 migrations apply lvbt-platform --remote                      # production
pnpm exec wrangler d1 migrations apply lvbt-platform-preview --env preview --remote  # previews
pnpm exec wrangler d1 migrations apply lvbt-platform --local                       # your machine
```

Wrangler records which migrations have run in a `d1_migrations` table, so running the command again changes nothing. `pnpm exec wrangler d1 migrations list lvbt-platform --remote` reports what has run.

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
| `deleted_at`                | When the person was deleted; their personal fields are cleared at that moment and the row is removed 30 days later.   |

## consent_records

Evidence that a person agreed to something.

| Column                             | Meaning                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `id`, `person_id`                  | The record and the person it belongs to.                                     |
| `scope`                            | What they agreed to: `newsletter`, `event_reminders` or `volunteer_contact`. |
| `given_at`                         | When they agreed.                                                            |
| `source`                           | Where they agreed, such as `join_form`, `newsletter_box` or `google_form`.   |
| `method`                           | How: `checkbox`, `double_opt_in`, `paper_signature` or `unknown`.            |
| `wording_version`                  | The exact wording they saw, such as `join-form-v1`.                          |
| `withdrawn_at`, `withdrawn_source` | When and where they took it back, if they did.                               |

## field_sources

Where each field on a person came from: one row per person and field, naming the source that last set it and when.

## identities

A link between a person and their account on another platform.

| Column           | Meaning                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `platform`       | `beehiiv`, `notion_intake`, `google_workspace`, `discord`, `givebutter` or `luma`.                  |
| `external_id`    | The account's identifier on that platform; unique per platform.                                     |
| `external_email` | The email address that platform holds, if any.                                                      |
| `link_method`    | How the link was made: `verified_email`, `staff_confirmed`, `self_linked` or `created_by_platform`. |

## engagement_events

One timestamped thing a person did, such as joining. Events are only ever added: a database rule refuses any change to an existing event. `details` holds extra facts as JSON, for example the interests ticked on the join form.

## review_queue

A possible match between two people that a staff member confirms (`merged`) or rejects (`kept_separate`).

## merges

The record of two people combined into one, with the moved rows as JSON so the merge can be undone.

## membership_rules

The versioned definition of who counts as a member. Version 1: anyone with an active newsletter consent is a member; someone who withdrew it is a former member.

## regions and zip_regions

`regions` lists LVBT's ten regions. `zip_regions` holds, for each ZIP code, the share of its 2020 population in each region; a ZIP code sets a person's region only when one region holds at least 90 percent. It is empty until the ZIP crosswalk is built, so for now members whose region can't be told from an address choose it themselves.

## rate_limits and form_submissions

`rate_limits` counts attempts per hashed caller per hour, so the join form can refuse an eleventh join from one connection. The caller is stored only as a keyed hash, never as an IP address. `form_submissions` remembers each join form's one-time token, so submitting the same form twice joins the person once.
