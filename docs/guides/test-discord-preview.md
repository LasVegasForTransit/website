# Test Discord in the isolated preview

Maintainers use this guide to prepare the isolated Discord server and verify account linking,
committee roles and removal. Complete [protected staff preview setup](./set-up-staff-preview.md)
first. Use only approved test accounts and the separate preview database and Discord server. The
test needs the scoped access and explicit test approval listed below. Keep production and newsletter
processing unchanged, and keep the preview jobs schedule empty.

## Prepare the isolated Discord preview

This procedure lets a maintainer prepare the test server without enabling Discord account linking or
background role changes. Before starting, complete the approved app, test-server, bot-permission and
credential setup in [platform secrets](../reference/platform-secrets.md#discord). The bot must be
above the test Member role. Keep the bot token only on `lvbt-jobs-preview` and the OAuth client
secret only on `lvbt-website-preview`; do not copy either value into source or release credentials.

1. In the `env.preview.vars` sections of `apps/jobs/wrangler.jsonc` and `apps/staff/wrangler.jsonc`,
   use the same approved public values:

   | Setting                            | Preview value         |
   | ---------------------------------- | --------------------- |
   | `LVBT_DEPLOYMENT_ENV`              | `preview`             |
   | `LVBT_DISCORD_APPLICATION_ID`      | `1552481672945999872` |
   | `LVBT_DISCORD_GUILD_ID`            | `1560146082640568350` |
   | `LVBT_DISCORD_PRODUCTION_GUILD_ID` | `1509298455896522823` |
   | `LVBT_DISCORD_MEMBER_ROLE_ID`      | `1560151428180353104` |

   Keep `LVBT_DISCORD_SYNC_ENABLED=false` on both Workers, newsletter synchronization disabled, jobs
   `triggers.crons` empty, and `release.previewOnly=true`. Leave production IDs and flags unchanged.
   The production server ID is a guard: preview must never use it as its active server.

2. The website's release source is `apps/deploy/cloudflare.config.ts`. Its `LVBT_DISCORD_JOBS`
   binding must target `lvbt-jobs-preview` in preview and `lvbt-jobs` in production. Declare the
   preview binding in `.lvbt/tooling.json` too. Regenerate the website compatibility file and types;
   editing only `apps/site/wrangler.jsonc` does not fix a typed release:

   ```sh
   pnpm -C apps/deploy compat:generate
   pnpm -C apps/site build:functions
   pnpm -C apps/site exec wrangler types --include-runtime=false
   pnpm -C apps/jobs exec wrangler types --include-runtime=false
   pnpm check
   ```

3. Leave `LVBT_DISCORD_APPLICATION_ID` unset on the website until the live preview test is approved.
   Website account linking checks the application ID, client secret and private jobs binding; it
   does not check the staff/jobs synchronization flag. Filling that website ID early exposes account
   linking while jobs is still unable to finish joining.
4. Publish the reviewed saved builds only through the approved protected preview procedures. Use the
   staff **setup** stage. Read back both Workers' disabled flags, the empty jobs schedule, the
   isolated database and the website's preview service target. With the approved preview account,
   confirm Discord account linking remains unavailable. If a target differs or linking appears, stop
   and correct the selected source and release; do not enable jobs to conceal the mismatch.

## Run an approved isolated Discord preview

Use this procedure to test real joining and role changes in the isolated server. Preparing or
merging configuration does not authorize live activation or provider writes.

Before starting, obtain explicit approval for the preview activation, the test accounts and their
role changes. Complete the [isolated setup](#prepare-the-isolated-discord-preview), protect the
preview with Access, and prepare a clearly marked non-admin member fixture in the preview database.
Use an explicitly authorized Discord tester, never the preview administrator or an unrelated member.
Confirm the bot has **Manage Roles** and **Create Invite**, sits above every test managed role, and
the app allows `https://preview.lasvegasfortransit.org/account/discord/callback`. Plan the
[shutdown](../reference/staff-release-operations.md#shut-down-the-isolated-discord-preview) before
enabling anything.

Preview must remain unscheduled. Automatic maintenance and queued retries are deferred while its
cron is off; request-driven integrations remain available. Exercise scheduled two-way behavior with
`pnpm -C apps/jobs test:e2e` against isolated local storage and synthetic providers. Those fixtures
invoke scheduled events explicitly and never enable a live cron. A live background-worker rehearsal
requires a separately reviewed execution path with explicit work and database limits; ordinary
preview launch cannot enable it. Before approving any live provider test or future background
rehearsal, select the LVBT account in Cloudflare, open **Storage & databases → D1 →
lvbt-platform-preview → Console**, and run each of these read-only statements separately:

```sql
SELECT count(*) AS linked_discord_accounts
FROM identities WHERE platform='discord';

SELECT kind,state,count(*) AS pending_jobs
FROM integration_outbox
WHERE state IN ('queued','running','retry')
GROUP BY kind,state ORDER BY kind,state;

SELECT
  (SELECT count(*) FROM people
   WHERE deleted_at IS NOT NULL AND erased_at IS NULL) AS archived_unerased_profiles,
  (SELECT count(*) FROM people
   WHERE deleted_at IS NULL AND date(created_at)<=date('now','-18 months')) AS older_active_profiles,
  (SELECT count(*) FROM people
   WHERE erased_at IS NOT NULL
     AND julianday(deleted_at)<julianday('now','-30 days')) AS erased_purge_candidates;
```

No pending-job rows means that queue is empty. Require zero linked accounts, pending work and
profile candidates, or privately identify every affected record as explicitly approved disposable
test data. The profile counts are conservative: the age check includes the whole cutoff day and does
not evaluate consent, linked identities, engagement, merge protection or the daily run's exact
cutoff. Check candidates against [the retention rules](./operate-member-data-retention.md) before
deciding what a controlled test can affect. Stop if any account or record falls outside the approved
test scope; do not delete records merely to clear this check. These checks do not authorize enabling
a recurring preview schedule.

1. Prepare the staff/jobs source change first. Set `LVBT_DISCORD_SYNC_ENABLED=true` only in both
   preview configurations and retain `env.preview.triggers.crons=[]` on jobs. Keep the reviewed
   isolated IDs and database unchanged, newsletter synchronization off, production unchanged and
   `release.previewOnly=true`. Leave the website application ID absent or empty. Regenerate jobs
   types and run `pnpm check` before review. This first change must be safe for automatic website
   preview publication: it must not expose account linking.
2. Select the successful main-branch **Build staff release** run for that reviewed source. After
   live approval, run **Deploy staff preview** with that **release_run** and **stage: launch**,
   following
   [the saved-release procedure](../reference/staff-release-operations.md#prepare-the-saved-artifact).
   Do not choose **setup**; it requires Discord and schedules to remain disabled.
3. Read back the receipt's exact staff/jobs versions at 100 percent traffic and the actual jobs
   schedule is empty. Run `pnpm staff:preflight --preview --json` with the approved scoped
   credential and require every configuration check to pass. Verify the isolated database, Access
   protection, enabled preview flags and disabled newsletter processing. Stop on a mismatch;
   configuration readiness alone does not prove role changes work.
4. Prepare a separate website change last. Set the preview `LVBT_DISCORD_APPLICATION_ID` text
   binding in `apps/deploy/cloudflare.config.ts` and `.lvbt/tooling.json` to the approved app ID.
   Retain an explicitly empty production counterpart. Regenerate compatibility configuration,
   compile functions, regenerate site types and run `pnpm check` using the commands above. Review
   and publish the saved website preview through its normal protected procedure only after step 3.
   PR workflows can publish isolated website previews automatically; retained staging requires a
   dispatch, including the existing calendar refresh. Do not push this second change before
   staff/jobs readiness is confirmed. Confirm linking appears only on preview.
5. Sign in as the marked member fixture and connect the authorized tester's Discord account. A
   fresh-join test requires an account that is not already in the test server; an existing server
   account cannot prove automatic joining. Confirm the account joins the isolated server and gains
   its Member role. A saved link or queued request alone is insufficient. Verify a recoverable
   failed attempt can be retried without duplicate linking.
6. Assign the fixture to two test committees and confirm both committees' actual Discord roles.
   Remove one assignment and confirm the other entitlement remains. End the fixture's membership and
   confirm the Member and remaining managed roles are removed. An unrelated test role must survive
   every change. In the approved unlinked-account case, confirm staff review is flagged and existing
   roles stay unchanged; never use a real member's access for this check.
7. Keep concise outcomes in the private acceptance record. On failure, stop adding test work and
   follow
   [activation recovery](../reference/staff-release-operations.md#recover-a-failed-preview-activation)
   or [shutdown](../reference/staff-release-operations.md#shut-down-the-isolated-discord-preview).
   Undo only approved fixture changes. Shut down website linking first, then staff/jobs and the
   schedule, and verify the final disabled state. Keep production, newsletter processing and
   unrelated accounts unchanged throughout.

The `/link` command separately needs its public key, guild-only registration and a Discord-reachable
signed interaction endpoint. Do not remove preview Access protection to make that check pass.
