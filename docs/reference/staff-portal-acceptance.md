# Staff portal acceptance

The portal is **not released**. This record separates local fixture results from deployed and human
acceptance. It contains no member contact details.

## Release identity

| Field                 | Current evidence                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local checkout HEAD   | `469b3e4c6a06c700fde7b41a58502428d053eb36`                                                                                                                            |
| Branch status         | `codex/staff-portal-current-main` is 4 commits ahead of `origin/main`; Discord interaction, command-registration, configuration and staff UI changes are uncommitted. |
| Pull request          | Draft PR #104 points to this HEAD and its latest remote checks passed. Local uncommitted changes are not included in those checks.                                    |
| Deployed source SHA   | None; no staff or jobs Worker is deployed in preview or production.                                                                                                   |
| Intended staff URLs   | `https://staff-preview.lasvegasfortransit.org/` and `https://staff.lasvegasfortransit.org/`; neither hostname returned an A or AAAA DNS answer on 2026-10-10.         |
| Human tester and date | None recorded.                                                                                                                                                        |

The local checkout has uncommitted portal implementation work. Its HEAD is not a releasable source
revision.

## Local evidence

With Node 24.20.0 and dependencies restored by `pnpm bootstrap`, the site package suite passes
258/258 tests, the staff package suite passes 45/45, and the deployment configuration suite passes
6/6. Site lint, Astro and script type checks, the site Worker build, staff lint and type checks, and
the compiled staff browser workflow also pass. The browser checks cover member search and
assignment, access controls, profile corrections, Discord status alignment and staff action buttons.
The new `/link` handler and guild command registrar are covered by the site test suite. Screenshots
are saved under `apps/staff/test-results/staff/`.

Dedicated compiled-Worker browser tests also pass for paper signup and Discord account, server
presence and role observations, including withdrawal and removal. The Discord checks use an isolated
provider fixture; they do not prove live Discord access or a deployed role sync.

The saved site Worker artifact now routes `/platform/discord/interactions` through the Worker before
static assets. Deployment tests confirm that routing and that the website manifest forbids
`LVBT_DISCORD_BOT_TOKEN`; the documentation reserves that secret for `lvbt-jobs`. The configured but
unlinked roster test also confirms a filtered page retains its Discord status column. These local
changes still need a reviewed release before the endpoint can be reached there.

The latest whole-repository `pnpm check` remains non-passing in this linked worktree:
`security:secrets` reports matches in Git history, and Turbo cancels some parallel tasks afterward,
which appears as pending-Promise errors. All seven package test suites pass when run sequentially:
platform core 14/14, platform storage 171/171, platform integrations 112/112, jobs 1/1, site
258/258, staff 45/45, and deploy 6/6. A clean remote CI run for the current branch SHA is still
needed. The production preflight passes all nine local machine checks under Node 24.20.0 when the
account ID is read from Wrangler, but production is not ready: 21 of 29 D1 migrations are unapplied,
`LVBT_PRESS_DATA_SOURCE_ID` is missing, and the Discord bot token remains on the public website
Worker. The staff-specific preflight confirms the source configuration uses the shared membership
database and protected staff domain, but Discord remains disabled and remote staff/jobs, Access, and
human acceptance checks are unverified without a scoped Cloudflare API token. These checks were
read-only; no production settings changed. Local test results establish behavior only; they do not
establish a deployed portal.

## Remote inventory

The latest read-only site preflight on 2026-10-10 confirms that the public `lvbt-website` Worker and
its custom domains are deployed, and that `lvbt-platform` exists and is bound. It confirms that 21
of 29 migrations remain unapplied, from `0009_workspace_sign_in.sql` through
`0029_roster_import_provenance.sql`; `LVBT_PRESS_DATA_SOURCE_ID` is missing; and the Discord bot
token is set on the public Worker even though the local manifest now forbids it there. The Discord
application credentials are also set on the public Worker. An unsigned POST to
`/platform/discord/interactions` returned HTTP 405 on 2026-10-10, so the interaction handler is not
live. The current local release artifact routes that path to the Worker, but it has not been
deployed. Separate read-only Wrangler checks on 2026-10-10 returned “Worker does not exist” for
`lvbt-staff`, `lvbt-staff-preview`, `lvbt-jobs`, and `lvbt-jobs-preview`. DNS lookups returned no A
or AAAA records for the staff or staff-preview hostnames. The staff-specific preflight cannot
inspect remote Workers or Access without a scoped read-only Cloudflare API token. No Worker, route,
DNS record, secret, Access policy or migration was created or changed during these checks.

Cloudflare Access applications and policies, credential validity, provider configuration and current
account-zone coverage remain unverified. The staff preflight reports Discord synchronization
disabled in the staff/jobs Worker configuration. Whether the existing public Worker has a bot token
is also unverified; the local manifest now forbids it there. Remote staff/jobs and Access checks
were not run because the preflight has no scoped Cloudflare API token.

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
