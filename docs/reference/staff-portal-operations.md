# Staff portal setup and release

The staff application serves `staff.lasvegasfortransit.org`. Its protected preview serves
`staff-preview.lasvegasfortransit.org`. The scheduled jobs Worker has no public route. All three
applications, including the public website, use one canonical membership schema; preview uses a
separate database and Discord server.

The portal has not been released. The staff workflows save compiled applications and migrations,
then upload and activate a selected saved build in preview after maintainer setup. Production
promotion remains unfinished. The website's bootstrap and promotion workflows do not provision or
promote staff and jobs. Keep production Discord synchronization disabled until the configuration and
live preview acceptance below are verified.

## Read-only configuration check

From the repository root:

```sh
pnpm staff:preflight --preview
pnpm --silent staff:preflight --production --json
```

The command reads local Worker configuration and migration filenames. With `CLOUDFLARE_ACCOUNT_ID`
and an approved `CLOUDFLARE_API_TOKEN` in the environment, it also reads bindings of every actively
served Worker version, active deployments, custom domains, schedules, Access applications and every
page of their policies. It checks jobs subdomain flags, custom domains and ordinary routes in every
accessible account zone. Its only POST is the fixed `SELECT name FROM d1_migrations ORDER BY id`
metadata query. It never creates resources, changes secrets, applies migrations, deploys code or
prints provider response bodies.

Use an account-scoped token with permission to read Workers, custom domains, Access applications and
policies, and D1 migration metadata. A denied or incomplete inventory is reported as **unverified**.
The command does not load or transfer another tool's login. Never paste a token into a command
argument or save it in a tracked file.

Exit status 0 means all inspected configuration requirements passed. It does **not** mean the portal
is ready for staff: the report separately lists live acceptance as unverified. Exit status 1 means
configuration is missing, invalid or unverified; 2 means invalid command arguments. The command
defaults to preview and rejects selecting both environments.

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
   mappings; confirm the bot can manage them while leaving unrelated roles alone.
7. Verify the president's linked Workspace identity before running the existing explicit
   administrator designation. Do not infer admin access from a domain, group, email or token.

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
create its review protections. Complete the existing Worker, Access, database migration, domain,
schedule and provider setup first. Cloudflare version uploads require an existing Worker; a failed
upload does not fall back to a first deployment.

A maintainer with a clean checkout of the verified build's commit can run the same two steps:

```sh
pnpm staff:release upload --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target preview --receipt /tmp/staff-deployment.json
pnpm staff:release activate --repository LasVegasForTransit/website --run-id <Actions-run-ID> --directory /tmp/selected-staff-release --target preview --receipt /tmp/staff-deployment.json
```

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

### Activate and verify

A release must record the source commit, canonical migration names, staff and jobs version IDs,
Access hostnames and acceptance evidence. Build and review all applications from that same source.
Do not rebuild a different artifact while promoting a reviewed release. Public website promotion
remains separate.

Before applying migrations, a maintainer takes and verifies a database backup and reviews the
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
When it is ready, set `LVBT_GOOGLE_CUSTOMER_ID` to the selected customer's ID and
`LVBT_GOOGLE_PRODUCTION_CUSTOMER_ID` to the production customer's ID. Production must match that ID;
preview must use a different customer. These public values only let the staff screens recognize the
context attached to a saved observation. They do not enable the Google runner or prove access. If
the setting is disabled, missing or points preview at production, observations stay unconfigured.

Verify the existing service account, immutable repository restrictions, delegated administrator and
Workspace customer read-only before enabling execution. Keep tokens out of saved builds, artifacts,
logs and source control. Do not create a key or relax organization policy when setup is unavailable.
Real preview grant, readback, revocation and retry evidence remains required before production use.

## Historical roster preview

Give the read-only import command a reviewed JSON array normalized to the roster evidence fields. It
prints aggregate counts and row numbers with conflict reasons; it omits email addresses and provider
IDs. It does not write member records or a report file.

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
