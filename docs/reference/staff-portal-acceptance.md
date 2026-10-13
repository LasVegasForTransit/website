# Staff portal acceptance

The portal is **not released**. This record separates local fixture results from deployed and human
acceptance. It contains no member contact details.

## Release identity

| Field                     | Current evidence                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Current branch            | `codex/staff-portal-current-main`; [draft PR #104](https://github.com/LasVegasForTransit/website/pull/104) is the review surface for this work. |
| Latest implementation SHA | `0aba6ef2a83bc653f9470fd886be6b0f45163445`; local repository and staff browser checks pass with Node 24.20.0.                                   |
| Deployed source SHA       | None recorded; the last provider inventory (2026-10-10) found no staff or jobs Worker. Current remote inventory is unverified.                  |
| Intended staff URLs       | `https://staff-preview.lasvegasfortransit.org/` and `https://staff.lasvegasfortransit.org/`; neither hostname resolved on 2026-10-13.           |
| Human tester and date     | None recorded.                                                                                                                                  |

The portal is not released. The passing preview workflow packages the website Worker; it does not
deploy the protected staff portal.

## Local evidence

With Node 24.20.0, the staff Astro/type check, Worker build, 50 unit tests and compiled-Worker
browser journey pass locally. The browser journey covers roster search and assignment, access
controls, profile corrections, Discord status alignment and staff actions. The route-authorization
test now enumerates every file-based staff route and checks Access and console permissions. A
separate first-administrator journey verifies that the configured active member can complete setup
once, that the audit is recorded, and that the member roster opens afterward. These tests use
isolated fixtures; they do not prove a live deployment, provider configuration or human acceptance.

First-administrator setup uses a temporary `LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL` secret on the
staff Worker. Setup requires the approved president's existing Google Workspace session to match
both the configured email and Cloudflare Access identity, plus an active linked membership record.
The operation is one-time and audited. The maintainer removes the temporary secret after setup; the
procedure is in [staff portal operations](./staff-portal-operations.md).

With Node 24.20.0, the whole-repository `pnpm check` passed all 36 tasks on 2026-10-13, including
its full-history secret scan. The compiled staff browser suite passed against 5,000 synthetic
people. It covers the member roster at 320, 390, 640, 768, 1024 and 1440 pixels, including the
phone/table transition and no-horizontal-overflow checks. These fixture checks do not establish a
deployed portal, provider configuration or human acceptance.

## Remote inventory

The latest read-only site preflight on 2026-10-10 confirms that the public `lvbt-website` Worker and
its custom domains are deployed, and that `lvbt-platform` exists and is bound. It confirms that 21
of 29 migrations remain unapplied, from `0009_workspace_sign_in.sql` through
`0029_roster_import_provenance.sql`; `LVBT_PRESS_DATA_SOURCE_ID` is missing; and the Discord bot
token and Discord application credentials are set on the public Worker even though the local
manifest now forbids the token there. An unsigned POST to `/platform/discord/interactions` returned
HTTP 405 on 2026-10-10, so the interaction handler was not live then. The local release artifact at
that time routed the path to the Worker but had not been deployed. Separate read-only Wrangler
checks on 2026-10-10 returned “Worker does not exist” for `lvbt-staff`, `lvbt-staff-preview`,
`lvbt-jobs`, and `lvbt-jobs-preview`. The GitHub `staff-preview` environment lookup returned 404, so
the required protected environment and its reviewer/token setup were absent at that time. Current
DNS requests on 2026-10-13 still cannot resolve either staff hostname. No Worker, route, DNS record,
secret, Access policy or migration was created or changed during these checks.

Cloudflare Access applications and policies, credential validity, provider configuration and current
account-zone coverage remain unverified. The staff preflight reports Discord synchronization
disabled in the staff/jobs Worker configuration. Access checks could not be run because the
preflight has no scoped Cloudflare API token.

The read-only staff preflights for preview and production on 2026-10-13 pass the shared database,
staff-domain, protected-assets and jobs-exposure source checks, but fail `source.discord.enabled`;
the repository keeps synchronization disabled until maintainers configure and verify both apps.
Remote Worker, Access, database and account-zone inventory is unverified because the environment has
no `CLOUDFLARE_ACCOUNT_ID` or scoped `CLOUDFLARE_API_TOKEN`. All seven live acceptance gates remain
unverified. The pull request's preview job builds and packages without deployment credentials; it
does not upload or activate the staff or jobs Workers.

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
