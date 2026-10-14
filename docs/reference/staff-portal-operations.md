# Staff portal setup and release

For the complete first-time procedure, use
[Set up the protected staff preview](../guides/set-up-staff-preview.md). This reference explains the
configuration and release contracts behind those steps.

The staff application serves `staff.lasvegasfortransit.org`. Its protected preview serves
`staff-preview.lasvegasfortransit.org`. The scheduled jobs Worker has no public route. All three
applications, including the public website, use one canonical membership schema; preview uses a
separate database and Discord server.

The staff workflows save compiled applications and migrations, then upload and activate a selected
saved build in preview after maintainer setup. They do not promote staff or jobs to production. The
website's bootstrap and promotion workflows do not provision or promote these applications. Use the
build system and private acceptance record to determine what is deployed and verified. Keep
production provider writes disabled until configuration and live preview acceptance pass.

## Read-only configuration check

From the repository root:

```sh
pnpm staff:preflight --preview
pnpm staff:preflight --preview --setup
pnpm --silent staff:preflight --production --json
```

The command reads local Worker configuration and migration filenames. With `CLOUDFLARE_ACCOUNT_ID`
and an approved `CLOUDFLARE_API_TOKEN` in the environment, it also reads bindings of every actively
served Worker version, active deployments, custom domains for the selected staff and jobs Workers,
schedules, Access applications and every page of their policies. It checks jobs subdomain flags,
custom domains and ordinary routes in every accessible account zone. Its only POST is the fixed
`SELECT name FROM d1_migrations ORDER BY id` metadata query. It never creates resources, changes
secrets, applies migrations, deploys code or prints provider response bodies.

Limit Worker edit access to the selected staff and jobs Workers. Custom-domain inventory requires
account-wide **Workers Metadata Read-Only**; this includes settings, metrics and logs for production
Workers, so obtain maintainer approval for that scope. The checks also need Access applications and
policies Read, D1 Read, and Zone Read and Workers Routes Read across the account's zones. D1 Read
permits reading database records, including member data; the command itself only queries migration
names. Custom-domain queries include the selected Worker name instead of asking for all Workers'
domains. A denied or incomplete inventory is reported as **unverified**. The command does not load
or transfer another tool's login. Never paste a token into a command argument or save it in a
tracked file.

Exit status 0 means all inspected configuration requirements passed. It does **not** mean the portal
is ready for staff: the report separately lists live acceptance as unverified. Exit status 1 means
configuration is missing, invalid or unverified; 2 means invalid command arguments. The command
defaults to preview and rejects selecting both environments.

`--setup` checks whether the protected preview can be deployed for sign-in and staff workflow
testing before Discord is configured. It requires the same authentication, Access, isolated
database, migrations and exposure checks. Both source configurations and every active Worker version
must explicitly keep Discord disabled, and jobs must have no cron triggers. Only the Discord launch
configuration, bot-token and minute-schedule requirements can remain incomplete. The JSON includes
`stage: "setup"` and `setupReady`; it retains every launch check and unverified acceptance item.
This mode is refused for production and does not establish launch readiness.

## Maintainer setup

Use the existing values and approved applications in the
[Worker runtime configuration](../../packages/platform-integrations/src/worker-runtime-config.ts),
following [platform secrets](./platform-secrets.md). Agents must not set or rotate production
credentials.

1. Confirm the selected Cloudflare account and database. Production uses `lvbt-platform`; preview
   uses `lvbt-platform-preview`. Site, staff and jobs must bind the same database within each
   environment and use `packages/platform-storage/migrations`.
2. Create the dedicated `console-users@lasvegasfortransit.org` Workspace group. Admit only approved
   team members who are already LVBT members. Group entry grants no administrator permissions.
3. Protect each exact staff hostname with its own Access application and matching audience. Set
   application and policy sessions to 12 hours. Allow the Console users Google group and require the
   LVBT email domain. Do not add bypass policies or broader alternative allow rules. Review the
   Google identity provider and actual group membership separately.
4. Register the fixed staff and staff-preview Google callback addresses documented in
   [Google sign-in setup](./platform-secrets.md#google-sign-in-for-the-website). Keep dynamic
   preview origins disabled unless explicitly approved. Configure the existing sign-in and email
   bindings on staff. The sign-in signing secret must match the shared session storage; an existing
   secret name does not prove its value matches. Confirm a real sign-in before acceptance.
5. Add the non-sensitive Access audience and team domain to the staff source configuration's Worker
   variables for each environment before building the release. Upload replaces public variables;
   values added only to the remote Worker are not inherited. If an audience is stored as an opaque
   secret, its value cannot be compared through metadata: a maintainer must verify it without
   disclosing it. Do not rotate credentials to make an inventory pass.
6. Put the approved Discord bot token on jobs only. Staff needs the public Discord configuration,
   and the public site needs its existing OAuth client configuration for account linking. Use a
   separate preview server. Review the Member role and every committee's current and retired role
   mappings; confirm the bot can manage them while leaving unrelated roles alone. Enable Server
   Members Intent for roster review, and grant the bot Manage Roles and Create Invite. The public
   website must bind `LVBT_DISCORD_JOBS` to `lvbt-jobs` in production or `lvbt-jobs-preview` in
   preview. Joining passes the member's request-only Discord token over that private connection; the
   jobs Worker checks the matching environment and current membership. Keep direct jobs URLs
   disabled. Test joining, server-rule acceptance, retry, and multiple committee roles in the
   isolated preview before enabling production. Account disconnection must also be tested: confirm
   member and committee channel access ends while server membership and unrelated roles remain.
   Disconnection retains its verified account target until the reconciler confirms removal; failed
   requests recover through the same scheduled work. Apply the canonical disconnect-intent migration
   before publishing these controls.
7. Before the first administrator signs in, set the secret
   `LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL` on the selected staff Worker to the president's exact
   `@lasvegasfortransit.org` account. On `lvbt-staff-preview`, use an approved Google account linked
   to a clearly marked test member in the isolated preview database. This may be an existing staff
   Google account; do not copy production member records or permissions. Do not store this value in
   source control or use a personal email. The one-time setup page checks that this exact Workspace
   account is linked to an active LVBT member and that no administrator designation exists, then
   records the grant in the staff audit log. Once deployed, the first sign-in goes to that page
   automatically; the president completes the setup and verifies access. Remove the temporary secret
   after the audited designation is confirmed. Do not infer admin access from a domain or group
   alone.

## Release order and rollback

### Prepare the saved artifact

The **Build staff release** workflow validates a main-branch source commit, runs the compiled local
runtime suites, builds staff and jobs, and saves `staff-release-<Actions run ID>`. It has no
deployment credentials and does not upload Worker versions or apply migrations. CI also checks
packaging on pull requests.

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
configuration or hosted acceptance. Hashes detect changes; selection of a trusted successful Actions
run and artifact is still required for deployment provenance.

The **Prepare staff release** workflow accepts a successful **Build staff release** run ID. It
retrieves that exact run's artifact, checks repository and main-branch workflow provenance, verifies
the archive against GitHub's SHA-256 digest, and then checks the internal manifest and compiled
runtime. It has no deployment credentials. It does not rebuild, activate Workers or apply SQL.

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
requires provider readback showing those exact versions at 100 percent. It never rebuilds, applies
SQL, changes secrets, creates Workers or changes routes and schedules.

Before using the workflow, a maintainer must create the `staff-preview` GitHub environment with
required reviewers and main-only deployment protection. Set its `CLOUDFLARE_ACCOUNT_ID` variable and
scoped `CLOUDFLARE_STAFF_PREVIEW_API_TOKEN` secret. Referencing an environment in YAML does not
create its review protections. Complete the existing Worker, Access, database migration and domain
setup first. The workflow's default **launch** stage additionally requires schedule and provider
configuration. Choose **setup** for the initial protected preview with Discord disabled and no cron
triggers. This lets staff test sign-in and workflows before provider activation. It cannot enable
Discord, run background jobs, or deploy production. Cloudflare version uploads require an existing
Worker; a failed upload does not fall back to a first deployment.

A maintainer with a clean checkout of the verified build's commit can run the same two steps:

```sh
pnpm staff:release upload --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target preview --receipt /tmp/staff-deployment.json
pnpm staff:release activate --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target preview --receipt /tmp/staff-deployment.json
```

For initial setup, add `--stage setup` to both commands. The deployment receipt records the stage; a
setup receipt cannot be resumed as a launch deployment. Omitting the option retains the full launch
gate. Resolve the remaining configuration and live-provider acceptance before enabling schedules or
treating a setup preview as operational.

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
acceptance. Production promotion remains unfinished and is not available through these commands.

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
3. Read the failed step and run the read-only preflight for the receipt's stage. For setup, use
   `pnpm staff:preflight --preview --setup --json`. Repair only the named configuration problem
   through its authorized procedure. If the command supplies only a generic error and the failed
   requirement remains unknown, keep the deployment unresolved; do not bypass its checks.
4. Prepare the exact original successful build into a new directory using `staff:release prepare`.
   Check out its verified source commit in a clean checkout. Preserve the original receipt outside
   that artifact and retain a private copy before resuming.
5. With both uploaded versions recorded and approved scoped Cloudflare credentials available to this
   process, run only `staff:release activate` using that build, artifact, receipt, target, and
   stage, as shown above. Do not run `upload` again. Activation reconciles already active versions
   and refuses unexpected traffic.
6. Check both active deployments again, run the matching preflight, and open the protected staff
   hostname. Record activation and sign-in outcomes separately in the private acceptance record.

The installed GitHub workflow has no retained-receipt resume input. If its credential is available
only inside GitHub, do not extract the secret or substitute a browser session. A maintainer must
provide an approved execution path for the same artifact and receipt before recovery can continue.

### Activate and verify

A release must record the source commit, canonical migration names, staff and jobs version IDs,
Access hostnames and acceptance evidence. Build and review all applications from that same source.
Do not rebuild a different artifact while promoting a reviewed release. Public website promotion
remains separate.

Before applying migrations, a maintainer
[takes and verifies a database backup](../guides/back-up-membership-database.md) and reviews the
canonical upgrade against the current deployed schema. Apply migrations before activating code that
requires them. Keep scheduled jobs inactive while the applications and bindings are being updated.
Verify the protected preview first, including refusal on alternate hosts and direct asset requests.
Enable schedules and provider writes only after real preview grant, readback, retry and revocation
evidence exists.

Rollback changes application versions; it must preserve accepted consents, assignments, welcome
claims, events and provider cleanup work. Do not reverse migrations or restore an old database over
new staff activity. Validate any rollback version against the current schema before activation.

## Google committee access

The Google Directory adapter reconciles verified linked accounts against current and retained
committee group mappings. Each group has a separate, five-minute readback checkpoint so interrupted
work can resume. The account receipt is saved only after every group in the current plan is
confirmed, and expires with the earliest group proof. Future-dated checkpoints cannot confirm
current access. It does not complete Discord or mailing-list work. Migration 0026 preserves existing
Discord audit intents and adds Google intents and group checkpoints; a maintainer must review and
apply it with the other canonical migrations before running this code against hosted data.

Grants require the exact linked user ID, primary email and Workspace customer. Suspended, archived,
renamed or mismatched accounts are refused. Existing owners and managers keep their role while
assigned; withdrawal removes the selected direct membership regardless of role. Removal uses the
stable user ID and can continue after personal email has been erased. The adapter also checks
[effective membership](https://developers.google.com/workspace/admin/directory/reference/rest/v1/members/hasMember).
Inherited access remains an unresolved removal; the job does not modify unrelated ancestor groups or
report that access is gone.

The storage layer now supports a customer-scoped hourly drift scan. It pages through verified Google
links, includes former members for removal, and queues current work without storing contact details
in the checkpoint. This scanner is not yet connected to a hosted Google runner, so it does not by
itself produce or refresh provider observations.

Google quota deadlines are saved per Workspace customer so a new Worker instance honors a 429
response and stops selecting accounts until the deadline. Migration 0028 preserves existing Discord
pauses and must be reviewed and applied before hosted Google execution.

The group inventory reader lists registered groups independently of linked member records, using
[Directory membership pages](https://developers.google.com/workspace/admin/directory/reference/rest/v1/members/list)
with indirect membership included. It returns a complete in-memory inventory or fails without a
partial count. It preserves owners, managers and nested-group entries and counts each user once.
Domain-wide or unresolved external entries make the exact user count unavailable. Pagination is
limited to 50 pages of 200 entries within 30 seconds. A changed group ID, conflicting duplicate,
repeated cursor, malformed response or lost authorization invalidates the read. The reader changes
no memberships. Complete inventories can be saved atomically through the collection layer, retaining
only account IDs, types and roles. Migration 0032 adds this cache and failure metadata. Checks stay
current for five minutes; maintenance removes unused inventories after 24 hours. The administrator
view reads stored counts and differences without calling Google. Names and contact details come from
current authorized LVBT records, including after erasure. Failed, stale, incomplete and unconfigured
checks cannot confirm a count or offer mismatch actions. Accounts without a unique verified member
identity remain an aggregate review in Google Admin. Hosted collection still needs a verified Google
runner.

Supply complete, disjoint preview and production group registries, including retired mappings.
Missing mappings or credentials must remain unconfigured. Group renames, inherited access and
linked-account changes need review; do not broaden the registry or bypass identity checks to clear a
failure.

The adapter accepts an injected token source and has no service-account-key fallback. Hosted
execution and the token source still need wiring. Preserve the approved GitHub Actions Workload
Identity Federation and domain-wide delegation route described in
[the organizing-platform decision](../explanation/decisions/organizing-platform.md). The Google
[authentication action](https://github.com/google-github-actions/auth#inputs-generating-oauth-20-access-tokens)
supports a delegated subject and explicit scopes. That route requires both Workload Identity User
and Service Account Token Creator permissions on the approved external principal, plus Workspace
delegation for these scopes:

- `https://www.googleapis.com/auth/admin.directory.user.readonly`
- `https://www.googleapis.com/auth/admin.directory.group.readonly`
- `https://www.googleapis.com/auth/admin.directory.group.member`

The staff Worker can display those saved observations without receiving Google credentials. Keep
`LVBT_GOOGLE_ACCESS_OBSERVATIONS_ENABLED` false until the Workspace customer context is verified.
Both environments use LVBT’s pinned Workspace customer: `LVBT_GOOGLE_CUSTOMER_ID` must match
`LVBT_GOOGLE_PRODUCTION_CUSTOMER_ID`. Isolate preview writes using different committee groups, not
another tenant for the same domain. Set `LVBT_GOOGLE_MANAGED_GROUPS` to a JSON array containing all
current and retained groups this environment may reconcile. Set `LVBT_GOOGLE_PRODUCTION_GROUPS` to
the complete production registry; preview managed groups must be disjoint from it, while production
managed groups must belong to it. Missing or conflicting registries leave observations unconfigured.
These values recognize saved observations; they do not enable the Google runner or prove access.

`LVBT_GOOGLE_CONSOLE_GROUP_EMAIL` explicitly registers the existing staff sign-in group for
read-only inventory. It must not overlap managed write groups. Its current user count appears
separately from committee groups, with an access-review reminder at 45 people. This counts Google
group members, not Cloudflare billable seats. The inventory view can be configured for this
read-only group alone without enabling committee reconciliation.

Verify the existing service account, immutable repository restrictions, delegated administrator and
Workspace customer read-only before enabling execution. Keep tokens out of saved builds, artifacts,
logs and source control. Do not create a key or relax organization policy when setup is unavailable.
Real preview grant, readback, revocation and retry evidence remains required before production use.

### Inspect Google setup without granting access

Google sign-in and Google group automation use different permissions. Complete these checks before
preparing any grant:

1. In Google Cloud, select **LVBT Core** and open **IAM & Admin → Service Accounts**. Open the
   existing `lvbt-website-admin@lvbt-core.iam.gserviceaccount.com`. Inspect **Keys** without
   creating or downloading one. An empty key list is compatible with the intended keyless design.
2. Open **IAM & Admin → Workload Identity Federation**. Inspect existing pools, providers, and
   service-account permissions. The intended trust must restrict the immutable LVBT repository
   identity and approved workflow context. A **Get started** page means no pool is configured; a
   service account existing by itself does not establish this trust.
3. In Google Admin, open **Security → Access and data control → API controls → Manage Domain Wide
   Delegation**. Find the service account's numeric client ID and inspect its approved scopes. An
   empty list or missing client means delegated Workspace access is unconfigured. Do not use **Add
   new** as part of this read-only check.
4. Verify the Workspace customer and intended delegated administrator against the approved design.
   The organizing-platform decision specifies the GitHub Actions route; no hosted runner is wired in
   this source. Resolve a proposed runner or administrator change in that design before granting
   permissions. Do not invent a Worker identity source or install a long-lived key as a shortcut.
5. Keep observations and writes disabled until the runner, token source, and actual provider tests
   are implemented and verified. Continue approved manual group administration in Google Admin.

If Google requests a passkey, the account owner completes it. Inspect Cloud and Admin separately;
successful sign-in to either service does not prove the other's configuration.

## Historical roster preview

Give the read-only import command a reviewed JSON array normalized to the roster evidence fields. It
prints aggregate counts and row numbers with conflict reasons; it omits email addresses and provider
IDs. It does not write member records or a report file.

Optional `givenName` and `familyName` fields retain names supplied with the source roster. Each
accepts up to 100 characters; surrounding whitespace is removed and blank values are ignored.
Imports fill missing names and preserve details already recorded, including a staff correction made
while the import is being saved.

```sh
pnpm --filter @lasvegasfortransit/site roster:preview --input /private/path/roster.json
```

Keep the input file and terminal output in an approved private workspace. Review source totals,
consent provenance, and duplicate resolution before any import is separately authorized. This
preview command has no apply option.

## Verification still required

Run `pnpm check`, then the compiled runtime suites sequentially after the build has finished:

```sh
pnpm -C apps/jobs test:maintenance
pnpm -C apps/jobs test:e2e
pnpm -C apps/staff test:e2e
pnpm -C apps/staff test:release
```

These use synthetic data and isolated providers. They cannot prove real Google sign-in, a complete
imported roster, Discord server operation, Google Group or mailing-list synchronization, production
deployment, or staff usability. Record real administrator, committee-lead and refused-account
outcomes, provider readback and recovery, three staff sessions including assistive technology, and
the agreed week of production use before declaring launch complete. Keep member contact data and
private task tracking out of public release evidence.
