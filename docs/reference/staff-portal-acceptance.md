# Staff portal acceptance

The portal is **not released**. This record separates local fixture results from deployed and human
acceptance. It contains no member contact details.

## Release identity

| Field                 | Current evidence                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Local checkout HEAD   | `eede3b76c8ec318e8bbd488ef613098bc9a4d595`                                                                                            |
| Branch status         | `codex/staff-portal-current-main` is pushed and clean.                                                                                |
| Pull request          | Draft [PR #104](https://github.com/LasVegasForTransit/website/pull/104) points to this SHA; its current checks are in progress.       |
| Deployed source SHA   | None; no staff or jobs Worker is deployed in preview or production.                                                                   |
| Intended staff URLs   | `https://staff-preview.lasvegasfortransit.org/` and `https://staff.lasvegasfortransit.org/`; neither hostname resolved on 2026-10-10. |
| Human tester and date | None recorded.                                                                                                                        |

The portal implementation is pushed for review, but is not released. The passing preview workflow
packages the website Worker; it does not deploy the protected staff portal.

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

The latest whole-repository `pnpm check` passes all 36 tasks in a fresh clone of the current branch
under Node 24.20.0. The linked development checkout still reports a local full-history secret-scan
finding, which cancels some Turbo tasks; the clean clone scan passes. All seven package test suites
also pass when run sequentially: platform core 14/14, platform storage 171/171, platform
integrations 112/112, jobs 1/1, site 258/258, staff 45/45, and deploy 6/6. The staff, paper-signup,
and Discord-observation browser workflows pass against isolated fixtures. For implementation SHA
`b98e797cd87d778a927ddf4f45ba22a5c42ebcea`, remote CI run 38041286429 passes and Worker preview
packaging run 38041286882 passes; Audit run 38041286445 was still running its desktop and mobile
Lighthouse jobs at the last check. The documentation-only SHA
`eede3b76c8ec318e8bbd488ef613098bc9a4d595` has CI run 38042191832, Worker preview packaging run
38042192293 and Audit run 38042191884 in progress. The passing preview workflow packages the website
Worker only; it does not deploy staff or jobs. The production preflight passes all nine local
machine checks under Node 24.20.0 when the account ID is read from Wrangler, but production is not
ready: 21 of 29 D1 migrations are unapplied, `LVBT_PRESS_DATA_SOURCE_ID` is missing, and the Discord
bot token remains on the public website Worker. The staff-specific preflight confirms the source
configuration uses the shared membership database and protected staff domain, but Discord remains
disabled. Remote staff/jobs Workers were checked separately; Access, credential validity and human
acceptance remain unverified. These checks were read-only; no production settings changed. Local
test results establish behavior only; they do not establish a deployed portal.

## Remote inventory

The latest read-only site preflight on 2026-10-10 confirms that the public `lvbt-website` Worker and
its custom domains are deployed, and that `lvbt-platform` exists and is bound. It confirms that 21
of 29 migrations remain unapplied, from `0009_workspace_sign_in.sql` through
`0029_roster_import_provenance.sql`; `LVBT_PRESS_DATA_SOURCE_ID` is missing; and the Discord bot
token and Discord application credentials are set on the public Worker even though the local
manifest now forbids the token there. An unsigned POST to `/platform/discord/interactions` returned
HTTP 405 on 2026-10-10, so the interaction handler is not live. The current local release artifact
routes that path to the Worker, but it has not been deployed. Separate read-only Wrangler checks on
2026-10-10 returned “Worker does not exist” for `lvbt-staff`, `lvbt-staff-preview`, `lvbt-jobs`, and
`lvbt-jobs-preview`. The GitHub `staff-preview` environment lookup returned 404, so the required
protected environment and its reviewer/token setup are absent. DNS lookups could not resolve either
staff hostname. No Worker, route, DNS record, secret, Access policy or migration was created or
changed during these checks.

Cloudflare Access applications and policies, credential validity, provider configuration and current
account-zone coverage remain unverified. The staff preflight reports Discord synchronization
disabled in the staff/jobs Worker configuration. Access checks could not be run because the
preflight has no scoped Cloudflare API token.

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
