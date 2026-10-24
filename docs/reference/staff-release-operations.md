# Staff release and recovery

Maintainers use this reference to build, select, activate and recover a reviewed staff/jobs release.
It does not release the public website. A saved artifact is the set of compiled files, settings and
SQL from one successful build. A deployment receipt records uploaded version IDs and the outcome of
activation so a failed command can be investigated without guessing.

Before publication, complete [maintainer setup](./staff-portal-operations.md#maintainer-setup), back
up the selected database and apply the reviewed migrations. You need authorized GitHub Actions
access; local commands also need the scoped credentials specified below. Keep the production hold
until its reviewed removal requirements are met. An error after a write can leave production
changed, so inspect the receipt and actual Cloudflare state before any retry.

Choose the section for your task:

- [Prepare a saved build](#prepare-the-saved-artifact).
- [Shut down the isolated preview](#shut-down-the-isolated-discord-preview).
- [Publish production](#publish-an-approved-staff-production-release).
- [Prepare the first production baseline](#prepare-the-first-production-baseline).
- [Recover failed preview activation](#recover-a-failed-preview-activation).
- [Inspect with a local credential](#inspect-with-an-approved-local-credential).
- [Interpret release errors](#interpret-safe-release-diagnostics).
- [Verify activation and rollback compatibility](#activate-and-verify).

## Release order and rollback

### Prepare the saved artifact

The **Build staff release** workflow validates a main-branch source commit, runs the compiled local
runtime suites, builds staff and jobs, and saves `staff-release-<Actions run ID>`. It has no
deployment credentials and does not upload Worker versions or apply migrations. CI also checks
packaging on pull requests.

Before starting a build, confirm the repository's `PUBLIC_LVBT_*` variables under **Settings →
Secrets and variables → Actions → Variables**. The staff build uses the same public website settings
as CI; [the environment example](../../apps/site/.env.example) lists them. Missing social or
donation URLs can fail the website's UI checks before an artifact is saved. Correct the public
variables and start a new build for the reviewed source; an unsuccessful run cannot supply a
release.

For a maintainer preparing a release locally, select a clean source checkout and an unused directory
outside it:

```sh
pnpm staff:release package --directory /tmp/staff-release --commit <full-source-commit> --release-id <Actions-run-ID>
pnpm staff:release check --directory /tmp/staff-release --commit <full-source-commit> --release-id <Actions-run-ID>
```

`package` refuses tracked or untracked source changes, checks the selected commit before and after
building, and saves the compiled staff modules, protected assets, jobs Worker, complete SQL
migration sequence and portable preview/production configurations. It omits local paths in generated
build configuration and jobs source maps. The staff build uses portable source locations in compiled
Astro metadata. Release variables are restricted to approved public configuration; provider
credentials belong in secret bindings. The manifest identifies the source commit and hashes every
file and migration. Reusing a destination fails instead of replacing a reviewed artifact.

`verify` checks the selected source identity and exact saved contents. `check` additionally runs all
four configurations through Wrangler's local version-upload dry run with bundling disabled. It uses
a temporary working copy so CLI cache files cannot change the saved artifact. Neither command
deploys code, changes schedules or applies SQL. A successful check proves packaging, not provider
configuration or real staff tasks. Hashes detect file changes. You must still select a trusted,
successful Actions run to establish where the files came from.

The **Prepare staff release** workflow accepts a successful **Build staff release** run ID. It
retrieves that exact run's artifact, checks that this repository's main-branch workflow produced it,
verifies the archive against GitHub's SHA-256 digest, and then checks the internal manifest and
compiled runtime. It has no deployment credentials. It does not rebuild, activate Workers or apply
SQL.

A maintainer can perform the same retrieval with an existing GitHub CLI login:

```sh
pnpm staff:release prepare --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release
```

Use a new directory. Failed or unfinished runs, fork builds, expired or ambiguous artifacts, digest
mismatches and unsafe archive paths are refused. The command reports the source commit, run ID,
artifact ID and hashes without printing provider output. A successful preparation verifies the saved
build; protected preview deployment and human/provider acceptance are still required.

The manifest contains file hashes. The **Deploy staff preview** workflow uploads those saved files
and saves the actual staff and jobs version IDs in a separate deployment receipt. It verifies each
uploaded version's source annotation, database and bindings before activating either version, then
requires an independent Cloudflare check showing those exact versions at 100 percent traffic. New
receipts also retain the previous and desired jobs schedules. Preview launch and resume require an
empty desired schedule and independently verify that jobs remain unscheduled after activation. Old
preview artifacts or receipts that would restore a recurring cron are rejected. Setup also keeps the
schedule empty. The workflow never rebuilds, applies SQL, changes secrets, creates Workers or
changes routes.

Before using the workflow, a maintainer must create the `staff-preview` GitHub environment with
required reviewers and main-only deployment protection. Set its `CLOUDFLARE_ACCOUNT_ID` variable and
scoped `CLOUDFLARE_STAFF_PREVIEW_API_TOKEN` secret. Referencing an environment in YAML does not
create its review protections. Complete the existing Worker, Access, database migration and domain
setup first. The workflow's default **launch** stage requires enabled provider configuration and an
empty preview schedule. Choose **setup** for the initial protected preview with Discord disabled and
no cron triggers. This lets staff test sign-in and workflows before provider activation. It cannot
enable Discord, run background jobs, or deploy production. Cloudflare version uploads require an
existing Worker; a failed upload does not fall back to a first deployment.

A maintainer with a clean checkout of the verified build's commit can run the same two steps:

```sh
pnpm staff:release upload --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target preview --receipt /tmp/staff-deployment.json
pnpm staff:release activate --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target preview --receipt /tmp/staff-deployment.json
```

For initial setup, add `--stage setup` to both commands. The deployment receipt records the stage; a
setup receipt cannot be resumed as a launch deployment. Omitting the option retains the full launch
gate. Resolve the remaining configuration and live-provider acceptance before treating a setup
preview as operational.

Use the separate **shutdown** stage below to return an enabled preview to disabled operation. Setup
requires the preview to be disabled already; it cannot stop a running preview.

Both commands require explicit scoped `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
credentials. They recheck the successful main build's GitHub artifact and reject a changed checkout
or saved artifact. Keep the receipt outside the artifact. Upload refuses an existing receipt. If
either step fails, retain its receipt and inspect provider state before retrying; an error can
follow a provider write. Activation with the same receipt skips versions already confirmed active,
preserves partial results, and refuses to overwrite a conflicting deployment after an acknowledged
activation. A configuration change can temporarily leave staff and jobs on different Discord
settings: resuming requires each active version to be either the recorded previous version or the
selected new version, with independently valid settings for the selected environment. Unexpected
versions and other configuration failures still stop activation. The workflow retains this receipt
even on failure. Configuration checks do not prove sign-in, live provider behavior or staff
acceptance. Production uses the separate protected procedure below and remains blocked while the
production hold is set.

### Shut down the isolated Discord preview

This procedure is for a maintainer authorized to stop the existing test-server integration. Before
starting, keep the reviewed test-server and Member-role IDs, isolated database, Access protection
and existing `staff-preview` deployment credential. Production and newsletter synchronization stay
unchanged. Shutdown stops new linking and scheduled work; it does not cancel provider requests that
are already running or remove roles already granted.

1. Disable website account linking first. In `apps/deploy/cloudflare.config.ts` and
   `.lvbt/tooling.json`'s `release.previewBindings`, set the preview `LVBT_DISCORD_APPLICATION_ID`
   text binding to an empty value, retaining the binding key and the production value. Regenerate
   the website's compatibility configuration and types:

   ```sh
   pnpm -C apps/deploy compat:generate
   pnpm -C apps/site build:functions
   pnpm -C apps/site exec wrangler types --include-runtime=false
   pnpm check
   ```

   Review and publish that saved **website preview** release through its normal protected procedure.
   Confirm the preview account page no longer offers connecting Discord. Do not use a dashboard-only
   setting. The staff release verifier does not inspect or prove this website prerequisite.

2. Prepare a separate reviewed staff/jobs shutdown build. In both `env.preview.vars` sections, set
   `LVBT_DISCORD_SYNC_ENABLED=false`. In jobs, retain `LVBT_BEEHIIV_SYNC_ENABLED=false` and set
   `env.preview.triggers.crons` to `[]`. Keep the application, test-server, production-guard and
   Member-role IDs unchanged and matching on staff and jobs. Keep `release.previewOnly=true` and all
   production settings unchanged. Run the normal full checks and select the successful **Build staff
   release** run for that main-branch source.
3. Run **Deploy staff preview** with that `release_run` and **stage: shutdown**. The protected
   workflow checks the known preview target, saves previous traffic and schedule state, and
   activates only the exact saved disabled staff/jobs versions. It then applies the empty jobs
   schedule and reads it back. A scoped local operator can use the same prepared artifact and an
   unused receipt path:

   ```sh
   pnpm staff:release upload --repository LasVegasForTransit/website --run-id <shutdown-build-run-ID> --directory /tmp/selected-staff-release --target preview --stage shutdown --receipt /tmp/staff-shutdown.json
   pnpm staff:release activate --repository LasVegasForTransit/website --run-id <shutdown-build-run-ID> --directory /tmp/selected-staff-release --target preview --stage shutdown --receipt /tmp/staff-shutdown.json
   pnpm staff:preflight --preview --shutdown --json
   ```

4. Require `shutdownReady: true`, both recorded disabled versions at 100 percent, and an empty
   actual jobs schedule. Verify website linking remains unavailable. Let any prior scheduled
   invocation and provider request finish; inspect the existing Worker logs and test-server roles
   before reporting that no work remains in flight. The configuration check alone does not prove
   cancellation.
5. If a step fails, preserve its receipt. Use **Recover staff preview** with the original build and
   deployment run, **stage: shutdown**, and **operation: inspect** before an approved **resume**. Do
   not substitute a setup/launch receipt or guess versions. Resume skips confirmed activations and
   stops on unexpected traffic or schedules. An uncertain schedule write is never sent again; a
   read-only check can confirm that it succeeded, otherwise stop for operator review.

Restarting requires a separately reviewed preview **launch** release with matching enabled Discord
settings and an empty saved schedule. Publish the website's nonempty preview application ID last,
after staff/jobs versions and the empty live schedule are verified. Restarting preview does not
resume automatic maintenance or queued retries. Never use shutdown to change production, newsletter
processing, Access policies or unlinked accounts' roles.

### Publish an approved staff production release

This procedure is for a maintainer releasing staff and jobs after configuration, provider and staff
acceptance. It does not publish the public website. Before you start, complete production Worker,
Access, domain, membership database and migration and provider setup. The existing staff and jobs
versions must be either valid configured versions or a verified disabled baseline. Jobs must have no
public route or URL. Both applications need their approved authentication and provider bindings;
enabling newsletter processing additionally requires its production publication, encrypted
API/intent keys, and `staff_review` conflict policy.

Prepare the top-level production variables in `apps/staff/wrangler.jsonc` and
`apps/jobs/wrangler.jsonc`; keep their `env.preview` settings unchanged. Staff needs the production
Access team's domain and its own exact `LVBT_ACCESS_AUD`. Both Workers need matching enabled Discord
settings, with `LVBT_DISCORD_GUILD_ID` equal to `LVBT_DISCORD_PRODUCTION_GUILD_ID` and the Member
role from that production server. Keep the bot token only on jobs. The production website separately
needs its matching Discord application ID, OAuth client secret, fixed callback and private jobs
binding. Publish website linking only after the staff/jobs versions and schedule are verified.

For the first launch, existing staff/jobs versions may be a verified disabled production baseline:
both must use the production identity, disabled provider flags, membership database and required
authentication bindings. Access, domain, database migration, privacy and credential checks still
apply. An empty existing jobs schedule is allowed; the selected launch artifact must contain the
minute schedule. The release commands apply it only after both exact versions are active. The
standalone production preflight describes the final enabled state, so disabled Discord and an empty
schedule can fail that report before first activation; use the protected release command's existing
baseline checks rather than enabling schedules in the dashboard.

#### Prepare the first production baseline

Use this procedure for existing disabled placeholders before the first production upload. You need
authorized access to the LVBT Cloudflare account, the approved production secrets, the exact
reviewed launch source, and separately authorized database migration access. Website bootstrap does
not configure staff or jobs. If a deployment already has a receipt, reconcile it through production
recovery before making settings changes; those changes can create new active versions.

1. In **Workers & Pages**, select the existing `lvbt-staff` and `lvbt-jobs` Workers. Create a
   missing placeholder with its exact name only when authorized. On both, disable `workers.dev` and
   preview URLs under **Settings → Domains & Routes**. Keep jobs without custom domains or ordinary
   routes. A placeholder supplies an existing Worker for version uploads; it does not serve the
   staff app.
2. Complete the [staff Access setup](./staff-portal-operations.md#maintainer-setup) for
   `staff.lasvegasfortransit.org`, including its own audience, the Console users Google group, the
   LVBT email-domain requirement and 12-hour sessions. On `lvbt-staff`, use **Settings → Domains &
   Routes → Add → Custom Domain** to attach that exact hostname. Verify its Access protection before
   attaching membership data. Keep the jobs Worker private.
3. Take and verify the [production database backup](../guides/back-up-membership-database.md), then
   rehearse the pending [database upgrade](#release-order-and-rollback) from the current schema.
   From the clean reviewed launch checkout, use the separately approved D1 credential to list, apply
   and recheck the production migrations:

   ```sh
   pnpm -C apps/site exec wrangler d1 migrations list lvbt-platform --remote
   pnpm -C apps/site exec wrangler d1 migrations apply lvbt-platform --remote
   pnpm -C apps/site exec wrangler d1 migrations list lvbt-platform --remote
   ```

   The final list must have no pending migration from the selected release. If apply fails, inspect
   migration history and schema objects before retrying; earlier migrations may already be applied.
   Staff release never applies migrations, so the later public website promotion cannot complete
   this prerequisite.

4. On both Workers, open **Bindings → Add binding**, choose **D1 database**, name the binding
   `PLATFORM_DB`, and select the existing `lvbt-platform` database. Compare its ID with the reviewed
   production configuration; never create a replacement database to fix an incomplete binding. On
   staff, also add a **Service binding** named `LVBT_NEWSLETTER_JOBS` targeting `lvbt-jobs`.
5. Under **Settings → Variables and Secrets**, set these as **Text** on the active baseline:

   | Workers | Variable                    | Baseline value                                               |
   | ------- | --------------------------- | ------------------------------------------------------------ |
   | Both    | `LVBT_DEPLOYMENT_ENV`       | `production`                                                 |
   | Both    | `LVBT_DISCORD_SYNC_ENABLED` | `false`                                                      |
   | Jobs    | `LVBT_BEEHIIV_SYNC_ENABLED` | `false`                                                      |
   | Staff   | `LVBT_ACCESS_TEAM_DOMAIN`   | The approved production team domain from staff source        |
   | Staff   | `LVBT_ACCESS_AUD`           | The exact production staff Access audience from staff source |

   Save the approved production Discord application, guild and role variables from the reviewed
   source on both Workers too, keeping synchronization disabled. On jobs, open **Settings → Triggers
   → Cron Triggers** and confirm there are no triggers. For a newly provisioned baseline, remove an
   existing trigger only through the approved setup operation. These disabled live settings are
   separate from the selected launch artifact's enabled flags and minute schedule.

6. Install missing approved secrets on their exact production destinations. Staff needs
   `LVBT_SIGN_IN_SECRET`, `LVBT_GOOGLE_OAUTH_CLIENT_ID`, `LVBT_GOOGLE_OAUTH_CLIENT_SECRET` and
   `LVBT_RESEND_API_KEY`. If staff has no approved signing key, provision an independent
   `LVBT_SIGN_IN_SECRET` there and preserve the website's existing key and member sessions. Use the
   dedicated [staff Google client](./platform-secrets.md#google-sign-in-for-the-staff-portal) with
   its sole fixed production staff callback and the domain-restricted
   [staff email key](./platform-secrets.md#staff-email-key). Save new values in the approved secret
   store at creation time; encrypted Worker settings cannot reveal them later. Website bootstrap
   does not install staff credentials. Jobs needs `LVBT_DISCORD_BOT_TOKEN` even for this disabled
   production baseline. Enabled newsletter delivery also needs `LVBT_BEEHIIV_API_KEY` and
   `LVBT_NEWSLETTER_INTENT_KEY` on jobs. Keep bot, Beehiiv and intent keys off staff.

   Choose **Secret** in the same dashboard panel, or use the following interactive commands from the
   repository root for values that are missing. Supply values only at each hidden prompt from the
   approved secret store; do not overwrite a working value to make an inventory pass.

   ```sh
   pnpm -C apps/staff exec wrangler secret put LVBT_SIGN_IN_SECRET --name lvbt-staff
   pnpm -C apps/staff exec wrangler secret put LVBT_GOOGLE_OAUTH_CLIENT_ID --name lvbt-staff
   pnpm -C apps/staff exec wrangler secret put LVBT_GOOGLE_OAUTH_CLIENT_SECRET --name lvbt-staff
   pnpm -C apps/staff exec wrangler secret put LVBT_RESEND_API_KEY --name lvbt-staff
   pnpm -C apps/jobs exec wrangler secret put LVBT_DISCORD_BOT_TOKEN --name lvbt-jobs
   ```

   [Secret changes deploy a new version immediately](https://developers.cloudflare.com/workers/configuration/secrets/#adding-secrets-to-your-project).
   Finish these durable runtime secrets before release upload and retain the active baseline
   privately. Install the temporary `LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL` only after the
   selected staff release is activated, following
   [maintainer setup](./staff-portal-operations.md#maintainer-setup).

7. Read back the active baseline with the approved configuration-check credential:

   ```sh
   pnpm --silent staff:preflight --production --json
   ```

   A disabled baseline can exit with status 1 because `discord.configuration` and `jobs.schedule`
   fail the final enabled-state requirements. Every other configuration check must pass, including
   the database migration inventory, staff authentication, private service, Access policy, custom
   domain and jobs exposure. An **unverified** check is not eligible for deferral. Correct the named
   prerequisite before attempting upload. The protected launch command handles these two expected
   baseline failures and applies the saved schedule after activating both exact versions; there is
   no production setup mode. Configuration checks leave live sign-in and provider acceptance
   unverified.

#### Activate the selected production release

For the full membership launch, enable production `LVBT_BEEHIIV_SYNC_ENABLED` with both publication
IDs identifying LVBT Updates and `LVBT_BEEHIIV_CONFLICT_POLICY=staff_review`. Install its approved
API and intent keys only on production jobs. Preview newsletter processing stays disabled. Scheduled
API processing works on Free and requires no webhook or paid plan. Verify a real signup reaches the
mailing list before accepting the membership website launch.

Create and protect the **`staff-production`** GitHub environment before using the workflow: require
maintainer review and main-only deployments. Set `CLOUDFLARE_ACCOUNT_ID` and the separately approved
`CLOUDFLARE_STAFF_PRODUCTION_API_TOKEN` there. Limit Worker edit permission to `lvbt-staff` and
`lvbt-jobs`; retain the read permissions listed in the configuration-check section. The token needs
permission to update the jobs schedule. Naming an environment in the workflow file does not
configure required reviewers or authorize credentials. Configure those protections in GitHub first.
Do not reuse the preview deployment key.

1. Complete the separate reviewed launch change. It must clear `release.previewOnly` only after its
   acceptance requirements are met, set the approved production provider flags, and retain
   `triggers.crons: ["* * * * *"]` in the production jobs source. Keep other environments unchanged.
   Both the trusted verifier and selected source must allow production; an older saved build cannot
   bypass a current hold. Production has no setup or shutdown mode.
2. Select the successful **Build staff release** run for that reviewed source. Use **Prepare staff
   release** to check its exact artifact and runtime. Review the saved build and required live
   acceptance before approving deployment. Do not substitute a newer build or rely on passing
   configuration checks as acceptance.
3. Run **Deploy staff production** from `main` with that `release_run`. Approve the protected
   environment only after checking the selected build and target. The workflow retrieves the exact
   saved artifact and checks its source, database, Access, privacy and provider configuration. It
   verifies uploaded bindings, activates the recorded staff/jobs versions, and requires independent
   confirmation that both versions receive 100 percent of traffic before applying the saved jobs
   schedule. It records the schedule intent before its single update request and verifies the
   complete schedule afterward.
4. Confirm the retained receipt is active with both versions and schedule confirmed. If no
   administrator exists, install the temporary first-administrator setting on the active staff
   Worker and complete [maintainer setup](./staff-portal-operations.md#maintainer-setup). This
   includes Google sign-in, member linking, the audited designation, removal of the temporary
   setting, and a fresh normal sign-in. Secret changes deploy new Worker versions; record their
   actual active version IDs privately. Then verify staff workflows, scheduled membership processing
   and live provider outcomes. Deployment metadata alone does not establish production acceptance.
   Keep detailed records private.

The equivalent CLI commands, using approved credentials and a clean checkout of the selected source,
are below. Prepare into a new directory and use an unused receipt path. The preparation command
downloads and verifies the selected successful main build; it does not build another artifact.

```sh
pnpm staff:release prepare --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release
pnpm staff:release upload --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target production --stage launch --receipt /tmp/staff-deployment.json
pnpm staff:release activate --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target production --stage launch --receipt /tmp/staff-deployment.json
pnpm staff:release inspect --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target production --stage launch --receipt /tmp/staff-deployment.json
```

Run these from the clean selected source checkout, or append
`--source-directory /private/selected-staff-source` to upload, activate and inspect when the trusted
verifier uses a separate checkout. That directory must be clean and at the prepared build's exact
commit. The trusted verifier and selected source must both permit production.

Use **Recover staff production** for a failed activation. Supply the original `release_run`, the
completed `deployment_run` holding its receipt, and **inspect** first. A complete, matching receipt
is required; partial uploads cannot be inferred or silently retried. After resolving the reported
gate, choose **resume** with the same inputs. Recovery skips confirmed versions, rejects unexpected
traffic or schedule changes, and never repeats an attempted schedule write. If its response was
lost, a read-only check can confirm the desired schedule; if the outcome remains uncertain, stop and
obtain a reviewed recovery decision. Do not edit receipts, toggle dashboard schedules or redeploy to
erase the uncertainty. Preview receipts cannot authorize production; older preview receipts remain
recoverable but never acquire schedule-write permission.

Only the selected jobs schedule is changed; routes, secrets, migrations and billing remain separate
operations. Serialize deployment/recovery through their shared workflow concurrency group and avoid
manual Worker edits during a release. The
[Cloudflare schedules API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/update/)
does not offer a conditional update: immediate drift checks and recorded recovery protect the flow,
but cannot lock out a simultaneous dashboard edit. Cron propagation and actual execution must be
verified before relying on scheduled processing.

### Recover a failed preview activation

Use this procedure if **Deploy staff preview** fails during upload or activation. An error does not
establish whether Cloudflare changed traffic. Do not rerun the whole workflow to find out.

1. Open the failed Actions run. Download its `staff-preview-deployment-<run ID>` artifact and keep
   `staff-deployment.json` in an approved private location. If no receipt exists, inspect the upload
   step and actual provider state; do not invent a receipt or assume no version was created.
   Activation requires a complete receipt containing both staff and jobs uploaded versions. A
   partial upload with only one recorded version cannot use the activation command. Preserve that
   receipt and the actual provider state; completing a partial upload needs a separately reviewed
   recovery path. Do not edit the receipt to supply a guessed version.
2. In Cloudflare, select the LVBT account, then **Workers & Pages → lvbt-staff-preview →
   Deployments**. Compare the currently served version and traffic percentage with the receipt's
   selected version and recorded previous versions. Repeat for `lvbt-jobs-preview`. A version marked
   **Ready** with no traffic is uploaded, not active.
3. In GitHub **Actions → Recover staff preview → Run workflow**, choose `main`. Enter the original
   successful build's run ID as **release_run**, the completed deployment run holding its receipt as
   **deployment_run**, and the receipt's exact **stage**. Leave **operation** set to **inspect**.
4. Review the selected release and approve the existing protected `staff-preview` environment.
   Inspection verifies the archive, receipt, clean selected source, uploaded versions,
   configuration, and actual traffic. It sends no upload or activation command and does not change
   the receipt. Its report says `ready: true` only when the activation gates pass. A blocked
   inspection exits with failure and identifies the failed stage or configuration checks. Repair the
   specific cause through its authorized procedure; keep an unknown failure unresolved.
5. Once inspection passes, run **Recover staff preview** with the same selections and **operation =
   resume**. Review and approve that protected run. It rechecks the gates and activates only the
   recorded versions, preserving completed activation and refusing unexpected traffic. It never
   rebuilds or uploads. A completed recovery run retains its receipt under
   `staff-preview-deployment-<recovery run ID>`; that run can be selected for a later inspection or
   resumption if needed.
6. Check both active deployments again, run the matching preflight, and open the protected staff
   hostname. Record activation and sign-in outcomes separately in the private acceptance record.

Recovery uses the same scoped deployment credential and serialized deployment queue as the normal
preview workflow. Do not extract GitHub secrets, copy browser sessions, or create a broader key to
run recovery locally. Inspect and resume are separate choices; selecting inspect cannot activate a
version. Neither choice can deploy production or apply migrations. Setup recovery keeps schedules
empty; launch recovery may finish only its recorded schedule after the selected versions are active.

### Inspect with an approved local credential

Use the GitHub procedure above when the credential is installed only there. A maintainer with an
already authorized local credential can prepare the original build and retrieve its receipt:

```sh
pnpm staff:release receipt --directory /private/selected-staff-release --repository LasVegasForTransit/website --run-id <build-run-ID> --deployment-run <deployment-run-ID> --target preview --stage setup --receipt /private/staff-deployment.json
pnpm staff:release inspect --directory /private/selected-staff-release --repository LasVegasForTransit/website --run-id <build-run-ID> --target preview --stage setup --receipt /private/staff-deployment.json --source-directory /private/selected-staff-source
```

Replace paths and IDs with the reviewed selections. Prepare the artifact with
`staff:release prepare` first, and check out its exact source commit cleanly in
`/private/selected-staff-source`. The current trusted release tool runs recovery. The separate
checkout supplies the exact configuration used by the original build. Omit `--source-directory` only
when the verifier checkout itself is the selected source. Receipt retrieval needs the explicit
account ID and GitHub read access; it does not use a Cloudflare token. Inspection and activation
also require the approved scoped Cloudflare token. For a launch-stage receipt, use `--stage launch`
consistently.

Receipt retrieval accepts only a completed main-branch deployment or recovery workflow in this
repository, exactly one unexpired receipt artifact, its verified archive digest, and both uploaded
versions matching the selected build, account, environment, and stage. It refuses existing output
files. Malformed, missing, partial, foreign, or changed receipts cannot authorize activation.

| Failure stage                              | Meaning and next action                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `saved-build` or `saved-artifact`          | Verify the original successful build and its saved files; do not substitute a newer build.                                    |
| `source-checkout` or `saved-configuration` | Restore a clean checkout of that build's source and compare its saved configuration.                                          |
| `receipt`                                  | Verify the selected deployment run, complete receipt, account, and stage. Do not edit or guess recorded versions.             |
| `staff.version` or `jobs.version`          | The uploaded version could not be verified against the saved release; inspect its metadata before any activation.             |
| `configuration` or `setup-boundary`        | Read the named configuration checks and confirm setup keeps Discord disabled and jobs unscheduled.                            |
| `shutdown-boundary`                        | Confirm the disabled preview source retains the known isolated target and all security checks; disable website linking first. |
| `recorded-traffic`                         | Actual traffic differs from an allowed recorded transition or cannot be verified; investigate the provider state.             |
| A Worker `activation` or `readback` stage  | A deployment may have changed traffic; inspect both actual deployments and the retained receipt before resuming.              |

### Interpret safe release diagnostics

For maintainers investigating a stopped release, the command's error names its stage and safe check
IDs. The existing **Recover staff preview → inspect** report also includes a `diagnostics` object
for a blocked version or setup check. Keep the original build, deployment receipt and selected
environment available; use the inspection procedure above before considering recovery.

Deployment runs the selected build's source code. To use updated diagnostics, review and select a
new successful **Build staff release** from that source, then start a fresh deployment with a new
receipt after inspecting existing traffic. Retrying an older build retains its older deployment
code. Recovery of an existing receipt always keeps that receipt's original build and artifact.

An uploaded version may briefly return HTTP 404 with Cloudflare code `100146` before its metadata
can be read. Version verification retries only that response for the same recorded version, with at
most two minutes of delays. It never uploads a replacement or activates an unverified version.
Permission errors, other provider errors and mismatched configuration still stop immediately. If the
wait expires, retain the receipt and reconcile actual traffic before considering another upload.

- `failed` means the available configuration or metadata does not meet a requirement.
- `unverified` means the required evidence could not be read or interpreted. It does not establish
  that the configuration is wrong, and it still blocks release.
- `HTTP` and `Cloudflare codes` contain only a validated response status and bounded numeric error
  codes. They identify a rejected metadata read without exposing the response message or body.
  Missing status means no usable response status was captured. When several reads fail, the summary
  carries the first blocking read's provider details; each preflight check retains its own details.

| Check ID                                 | Interpretation and next action                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `provider.metadata`                      | Inspect the selected account and the workflow token's read permissions. A local CLI login may use a different identity.     |
| `version.metadata`                       | The uploaded version's binding inventory could not be interpreted; inspect that exact version through approved read access. |
| `version.id` or `version.annotation`     | Compare the uploaded version with the original receipt and saved build. Do not substitute another version.                  |
| `version.services` or `version.database` | Compare the saved service target and database with that uploaded version's metadata.                                        |
| `version.variable.<approved name>`       | Compare the named public variable with the configuration saved in the selected build without publishing its value.          |
| `version.binding.<approved name>`        | Check the required binding's presence and type; do not print its secret value.                                              |
| `version.forbidden_bindings`             | Staff contains a credential that belongs only on jobs. Correct the approved destination before another release.             |
| `version.newsletter`                     | Enabled newsletter processing does not meet the existing publication, conflict-policy and encrypted-binding requirements.   |
| `setup.<app>.source`                     | The selected preview source must retain disabled provider flags.                                                            |
| `setup.<app>.traffic`                    | Active preview traffic is missing or does not total 100 percent; read actual deployments before proceeding.                 |
| `setup.<app>.disabled`                   | An active version does not have the required preview identity and disabled provider flags.                                  |
| `setup.<app>.version_metadata`           | An active version's identity or bindings could not be interpreted.                                                          |
| `setup.jobs.schedule`                    | Confirm the preview jobs schedule is readable and empty.                                                                    |
| Other preflight check IDs                | Read the matching configuration check in the report and correct that requirement; deferred launch checks remain deferred.   |

For HTTP 401/403, check the exact workflow credential and its approved account/scope before changing
configuration. For HTTP 429, inspect account limits before another attempt. These codes alone do not
establish why a credential or request was rejected. A later successful read cannot explain an
earlier unreadable check.

Retain the receipt and read actual traffic and schedules before any retry: a failed command may
follow a provider write. Partial upload receipts cannot authorize activation or recovery. Any new
setup attempt requires review of the same immutable build and actual provider state, uses a fresh
receipt, and passes every existing gate. Do not edit receipts, suppress failed or unverified checks,
replace the selected artifact, or repeatedly dispatch to hide an unresolved failure. Keep detailed
provider evidence in approved private operational records.

### Activate and verify

A release must record the source commit, applied migration names, staff and jobs version IDs, Access
hostnames and acceptance evidence. Build and review all applications from that same source. Do not
rebuild a different artifact while promoting a reviewed release. Public website promotion remains
separate.

Before applying migrations, a maintainer
[takes and verifies a database backup](../guides/back-up-membership-database.md) and reviews the
database upgrade from the currently deployed tables. Apply migrations before activating code that
requires them. Keep scheduled jobs inactive while the applications and bindings are being updated.
Verify the protected preview first, including refusal on alternate hosts and direct asset requests.
Keep preview unscheduled and retain its request-driven integrations. Production schedule activation
and provider writes still require real evidence of granting access, checking it, retrying failed
requests and removing access in the outside service from an explicitly approved rehearsal. Local
synthetic fixtures alone do not satisfy production acceptance.

Rehearse pending migrations from the retained schema, including the migration-tracking inserts:

```sh
pnpm -C apps/site exec node --import tsx --test tests/d1-migration-compatibility.test.ts
```

Wrangler sends each remote migration and its tracking insert as one SQL string to D1's query API.
Its local splitter and ordinary SQLite can accept SQL that the remote parser rejects. Keep
`CASE … END` expressions inside trigger bodies parenthesized; a bare expression can be mistaken for
the end of the trigger. The compatibility regression checks every migration after 33 and exercises
its upgrade from schema 33 with retained administrators and newsletter activity. A local rehearsal
is not proof of a remote apply. If an apply fails, stop and read the migration tracker and expected
schema objects before retrying; earlier successful migrations remain applied. Correct only pending
migrations, and preserve data and SQL behavior. See
[Cloudflare's trigger parser issue](https://github.com/cloudflare/workers-sdk/issues/4727) and
[migration rollback behavior](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply).

Rollback changes application versions; it must preserve accepted consents, assignments, welcome
claims, events and provider cleanup work. Do not reverse migrations or restore an old database over
new staff activity. Validate any rollback version against the current schema before activation.
