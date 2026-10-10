# Staff portal acceptance

The portal is **not released**. This record separates local fixture results from deployed and human
acceptance. It contains no member contact details.

## Release identity

| Field                 | Current evidence                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local checkout HEAD   | `b92c14351f7a23e6d0449bc5a9cc160f2146e6f1`                                                                                                                    |
| Branch status         | `codex/staff-portal-current-main` is 2 commits ahead of `origin/main`; implementation changes are uncommitted.                                                |
| Deployed source SHA   | None; no staff or jobs Worker is deployed in preview or production.                                                                                           |
| Intended staff URLs   | `https://staff-preview.lasvegasfortransit.org/` and `https://staff.lasvegasfortransit.org/`; neither hostname returned an A or AAAA DNS answer on 2026-10-10. |
| Human tester and date | None recorded.                                                                                                                                                |

The local checkout has uncommitted portal implementation work. Its HEAD is not a releasable source
revision.

## Local evidence

The independent package test matrix passes all 9 Turbo tasks; lint and type checks pass all 19 Turbo
tasks. The compiled staff Worker browser test runs with JavaScript disabled against 5,000 synthetic
people; the latest search took 37 ms. The member search skip link and form work with keyboard-only
input. Discord server presence and managed-role status pass separately in an isolated provider
fixture. The staff preview and production preflights pass their local configuration checks except
that Discord is intentionally disabled; missing Cloudflare read credentials leave all remote
inventory and live acceptance checks unverified. The full `pnpm check` reaches formatting, Markdown
and `lvbt check` successfully, then stops at the secret-history scan because of matches in the
preserved local recovery stash. These results establish local behavior only.

## Remote inventory

Read-only Wrangler checks on 2026-10-10 returned “Worker does not exist” for `lvbt-staff`,
`lvbt-staff-preview`, `lvbt-jobs`, and `lvbt-jobs-preview`. Both the production and preview D1
databases report migrations `0009_workspace_sign_in.sql` through `0029_roster_import_provenance.sql`
as unapplied. DNS lookups returned no A or AAAA records for the staff or staff-preview hostnames. No
Worker, route, DNS record, secret, Access policy or migration was created or changed during these
checks.

Cloudflare Access applications and policies, credential validity, provider configuration and current
account-zone coverage remain unverified. Discord synchronization is disabled in the local Worker
configuration.

## Required acceptance

| Scenario                                                                 | Tester/date                        | Observed result | Remaining issue                                                                        | Evidence                                     |
| ------------------------------------------------------------------------ | ---------------------------------- | --------------- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| President sign-in, correct member link and administrator access          | Not run                            | Unverified      | Deploy preview and complete approved maintainer setup.                                 | None                                         |
| Committee lead sees only assigned members; unapproved account is refused | Not run                            | Unverified      | Deploy preview and use approved test identities.                                       | None                                         |
| Complete imported roster and consent provenance                          | Not run                            | Unverified      | Review the authoritative source roster and reconcile it after provider setup.          | None                                         |
| Provider retry and revocation against live accounts                      | Not run                            | Unverified      | Configure preview integrations and test approved identities.                           | None                                         |
| Three staff/volunteer sessions, including assistive technology           | Not run                            | Unverified      | Record real sessions and resolve blockers.                                             | None                                         |
| Keyboard and screen-reader acceptance on specified devices               | Partial local keyboard search only | Unverified      | Review protected routes, VoiceOver and the specified phone.                            | Local keyboard flow in compiled Worker test. |
| Protected preview release, rollback and one week of staff use            | Not run                            | Unverified      | Configure Access, DNS, migrations and reviewed releases; collect operational evidence. | None                                         |
