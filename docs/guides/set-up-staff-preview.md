# Set up the protected staff preview

Use this guide to prepare the staff portal for sign-in and workflow testing. The preview has its own
database, so testing a member profile or staff permission does not change production records.

## Before you start

You need an LVBT maintainer with access to Cloudflare, Google Workspace administration, the approved
Google Cloud project, Resend, and the website repository's GitHub settings. A staff tester needs an
LVBT Google account and an approved test membership in the preview database. You may use an approved
staff member's existing Google account with a clearly marked preview test record.

Use a clean checkout of the reviewed source. Install the repository's required Node.js and pnpm
versions with [the contributor setup guide](../tutorials/start-here.md). A Cloudflare Worker is an
application running on Cloudflare; a binding connects it to its database or another application. See
the [glossary](../reference/glossary.md) for unfamiliar terms.

Keep credentials in the approved secret store and the service's encrypted settings. The steps below
describe where to install them; never put their values in GitHub issues, task descriptions, chat,
screenshots, or tracked files. Creating credentials, granting permissions, and changing a database
require the maintainer's authorization for that specific environment.

## 1. Check existing resources before creating anything

In Cloudflare, select the LVBT account. Open each existing application and compare its configuration
with this table. Reuse correctly configured resources.

| Application     | Preview name           | Required connection                     |
| --------------- | ---------------------- | --------------------------------------- |
| Member website  | `lvbt-website-preview` | `PLATFORM_DB` → `lvbt-platform-preview` |
| Staff portal    | `lvbt-staff-preview`   | The same preview database               |
| Background jobs | `lvbt-jobs-preview`    | The same preview database               |

The website's `LVBT_DISCORD_JOBS` service binding must point to `lvbt-jobs-preview`. This is a
private connection between applications; it does not require making the jobs application publicly
reachable.

Check `apps/site/wrangler.jsonc`, `apps/staff/wrangler.jsonc`, and `apps/jobs/wrangler.jsonc` under
their `preview` environment. Each must select the preview database and the canonical migration
directory, `packages/platform-storage/migrations`. Check the deployed settings as well as the files.
The production database is `lvbt-platform`; do not select it for this procedure.

If a staff or jobs Worker is missing, an authorized maintainer opens **Workers & Pages → Create
application**, creates a placeholder Worker with the exact preview name, and disables its direct
URLs before adding access or data. Under **Bindings**, add a D1 database binding named `PLATFORM_DB`
and select `lvbt-platform-preview`. If the database itself is missing, create that empty database
under **Storage & databases → D1** first, and record its assigned ID in each reviewed preview
configuration. Never replace an existing database because its bindings are incomplete.

Existing Workers must exist before a saved version can be uploaded. A placeholder Worker is only a
provisioning step: a page saying **Hello World!** means the staff application is not serving that
hostname yet. The saved release supplies the application; do not paste application code into the
dashboard editor.

## 2. Prepare the preview database

First list the pending migrations without applying them:

```sh
pnpm -C apps/staff exec wrangler d1 migrations list lvbt-platform-preview --remote --env preview
```

Confirm that the command selects the preview database. Review the pending numbered SQL files against
the selected release. Before changing an existing database, follow
[Back up and verify the membership database](./back-up-membership-database.md). It includes export,
isolated restore, comparison, and private retention. A Time Travel bookmark identifies a provider
recovery point; retain an independent verified backup too.

After the maintainer authorizes the migration, apply that reviewed sequence:

```sh
pnpm -C apps/staff exec wrangler d1 migrations apply lvbt-platform-preview --remote --env preview
```

List migrations again. Every migration required by the selected application build must be applied. A
failed migration can leave earlier migrations applied; inspect the actual database before
continuing. The deployment workflow does not apply migrations for you. Cloudflare documents these
commands in its [D1 command reference](https://developers.cloudflare.com/d1/wrangler-commands/).

### Prepare the first test membership

Use an approved synthetic membership for the first administrator. This is preview fixture data, not
a real consent record or an import of the production roster. Keep provider writes and schedules
disabled. The maintainer needs separately authorized D1 write access; do not broaden the deployment
credential, which reads migration metadata only.

1. Confirm `lvbt-platform-preview` is the bound database and all selected migrations are applied.
2. Choose the approved tester's inbox address. The tester must own it, because account linking sends
   a confirmation code there. Check whether its preview test record already exists before inserting
   anything; reuse a matching approved fixture rather than making a second person.
3. Save the SQL below in a new private file outside the repository, such as
   `/private/approved-preview/staff-test-member.sql`. Replace `tester@example.invalid` with the
   approved lowercase inbox address. Keep the test name and fixture marker. Review the complete file
   and target before applying it.

```sql
INSERT INTO people (
  id, given_name, email, membership_status, membership_rules_version,
  created_at, updated_at
) VALUES (
  '01J00000000000000000000001', 'PREVIEW TEST', 'tester@example.invalid', 'member', 1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
INSERT INTO consent_records (
  id, person_id, scope, given_at, source, method, wording_version,
  created_at, updated_at
) VALUES (
  '01J00000000000000000000002', '01J00000000000000000000001', 'newsletter',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'import', 'unknown', 'preview-test-only',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
```

Apply it only to preview:

```sh
pnpm -C apps/staff exec wrangler d1 execute lvbt-platform-preview --remote --env preview --file /private/approved-preview/staff-test-member.sql
pnpm -C apps/staff exec wrangler d1 execute lvbt-platform-preview --remote --env preview --command "SELECT p.id, p.given_name, p.membership_status, c.wording_version, c.withdrawn_at FROM people p JOIN consent_records c ON c.person_id = p.id WHERE p.id = '01J00000000000000000000001'"
```

The readback must show the intended test person, `member`, `preview-test-only`, and no withdrawal.
The two inserts do not create a Google link, session, or administrator designation; the human
sign-in steps below establish those. The fixed IDs are canonical ULIDs, the identifier format
required by member profiles and roster pagination. Keep them unchanged; a repeat fails rather than
silently overwriting an existing person. If either insert fails, inspect both rows privately before
continuing; do not rerun or change an existing person's consent to make setup pass. Keep fixture
records out of roster imports and production. Real membership imports require separate consent and
duplicate review. After linking and administrator setup, search for this record, open its profile,
and confirm its committees and accounts load; a successful SQL insert alone does not establish a
usable test membership.

If an existing fixture uses a noncanonical identifier, stop using it for acceptance. Preserve its
account links, consents, and administrator audit history. Do not rename its key, disable identifier
validation, edit immutable history, or delete the record to restart setup. Follow
[linked preview membership recovery](./recover-a-preview-test-membership.md) to prepare, rehearse,
review, and verify a repair against a verified backup before changing linked test data.

## 3. Protect the staff hostname

Follow the numbered
[staff console service setup](../reference/platform-secrets.md#the-staff-console-google-group-google-sign-in-and-the-access-application)
to prepare the Google group and Cloudflare Access application. Access is the sign-in gate in front
of the portal; the portal then checks the person's membership and staff permissions.

Use a dedicated Access application for `staff-preview.lasvegasfortransit.org`, with its own audience
identifier and 12-hour application and policy sessions. Admit only the approved staff Google group
and LVBT domain. Group membership alone does not make someone a portal administrator.

Attach that exact custom hostname to `lvbt-staff-preview`. Disable the staff Worker's direct
`workers.dev` address and preview URLs. Keep all direct URLs, custom domains, and public routes
disabled for `lvbt-jobs-preview`.

Save the Access audience and team domain in the preview source configuration before building a
release. Uploading a version replaces its public variables; dashboard-only variables are not a
substitute for the saved configuration. The
[operations reference](../reference/staff-portal-operations.md#maintainer-setup) lists the required
bindings.

## 4. Configure Google sign-in and confirmation emails

Open the existing approved Google Cloud project in the LVBT browser profile. Use the project picker
to find **LVBT Core**; do not infer a Google project ID from a Cloudflare database name.

Follow [Google sign-in setup](../reference/platform-secrets.md#google-sign-in-for-the-website). The
preview sign-in client must allow these exact callback addresses:

```text
https://preview.lasvegasfortransit.org/sign-in/google/callback
https://staff-preview.lasvegasfortransit.org/sign-in/google/callback
```

Use the preview client credentials on the preview website and preview staff Worker. Keep their
session-signing secret consistent within that environment. Google sign-in uses name, email, and
profile; Google Workspace group administration is a separate integration.

To install an approved existing value, open the exact preview Worker in Cloudflare, select
**Settings → Variables and Secrets → Add**, choose **Secret**, enter its name and value from the
approved secret store, and save. Repeat for each destination below. Do not reveal, reset, or replace
a working value just to copy it; if the shared value is unavailable, coordinate an approved
rotation.

| Value                                                               | Destinations                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `LVBT_GOOGLE_OAUTH_CLIENT_ID` and `LVBT_GOOGLE_OAUTH_CLIENT_SECRET` | Preview website and preview staff                      |
| `LVBT_SIGN_IN_SECRET`                                               | Preview website and preview staff, with the same value |
| `LVBT_LINK_SIGNING_SECRET`                                          | Preview website for its member email links             |
| `LVBT_RESEND_API_KEY`                                               | Preview website and preview staff                      |

Use the reviewed source variables for nonsecret configuration. Confirm the exact Worker name before
saving a secret; the existing website bootstrap does not install staff-preview credentials.

Follow [Resend setup](../reference/platform-secrets.md#resend-sending-email) to verify
`notify.lasvegasfortransit.org` and install the approved sending-only credential. Confirmation
emails must work before first-administrator acceptance. Reuse existing approved credentials;
replacing a credential requires a coordinated rotation.

Google Cloud and Google Admin may each request a passkey. The account owner completes these prompts.
Completing one service's sign-in does not confirm the other service's access.

## 5. Protect GitHub deployment access

In the website repository, open **Settings → Environments → staff-preview**, creating that
environment if absent. Under deployment protection, require the approved reviewer and disable
administrator bypass. Under deployment branches, choose selected branches and add `main` only.
Verify these settings explicitly; naming an environment in a workflow does not create its protection
rules.

Set the environment variable `CLOUDFLARE_ACCOUNT_ID` and encrypted secret
`CLOUDFLARE_STAFF_PREVIEW_API_TOKEN`. The deployment credential needs edit permission only for the
two preview staff/jobs Workers. Its read permissions cover the database migration inventory, Access
settings, and domain/route inventory. Workers Metadata Read-Only also exposes production Worker
metadata, so that scope needs explicit approval. Set and record an expiration and a renewal owner in
the approved private credential record.

Reuse the installed credential when valid. To create an authorized replacement, open Cloudflare **My
Profile → API Tokens → Create Token → Create Custom Token**. Name it for the staff preview, select
the permissions in the operations reference, restrict edit resources to the two named Workers and
the LVBT account, and set the approved expiry. Inspect the complete scope summary before creating
it. If the available controls cannot express the approved restriction, stop and resolve that
permission boundary rather than selecting account-wide edit access.

Transfer the value directly into GitHub's **staff-preview → Environment secrets →
CLOUDFLARE_STAFF_PREVIEW_API_TOKEN**. Under **Environment variables**, set `CLOUDFLARE_ACCOUNT_ID`
to the LVBT account's ID. Store the credential in the approved private secret store too; do not put
it in an Actions variable. For renewal, verify the replacement with the read-only preflight, update
this one environment, and complete a verified deployment before revoking the previous credential.
Never revoke an in-use credential to test its replacement.

Use the
[operations reference](../reference/staff-portal-operations.md#read-only-configuration-check) for
the exact permission contract. A denied inventory is an unverified check; do not broaden the
credential until the maintainer approves the necessary scope.

## 6. Deploy one selected saved build in setup mode

Keep Discord synchronization disabled and background schedules absent during this stage. If the
selected source includes newsletter synchronization, keep that disabled too.

For newly created placeholders, prepare their active settings before preflight. On **both**
`lvbt-staff-preview` and `lvbt-jobs-preview`, open **Settings → Variables and Secrets** and save the
text variables `LVBT_DEPLOYMENT_ENV=preview` and `LVBT_DISCORD_SYNC_ENABLED=false`. On staff, also
set the exact `LVBT_ACCESS_TEAM_DOMAIN` and `LVBT_ACCESS_AUD` from step 3. Confirm its sign-in and
email values from step 4 are installed. In jobs **Settings → Trigger Events**, remove any cron
triggers through the approved setup procedure. Verify these settings on the active versions,
including the preview database binding; editing source alone cannot configure a placeholder.

Keep the same public variables in the reviewed source, because the next upload replaces them. The
preflight inspects both source and currently served versions; it must pass before the workflow can
upload the saved application.

From the repository root, run:

```sh
pnpm staff:preflight --preview --setup
```

An authenticated preflight checks remote configuration. Without an approved Cloudflare credential,
remote checks remain unverified. A successful setup check permits protected preview testing; live
provider acceptance is still separate.

In GitHub **Actions**, find a successful **Build staff release** run for the exact reviewed `main`
commit. Open **Deploy staff preview → Run workflow**. Select `main`, enter that saved build's run
ID, and choose **setup**. The default is **launch**, which requires additional provider
configuration.

When upgrading an older staff preview, setup mode may defer the check for its missing newsletter
service binding. Before activation, the workflow verifies that the uploaded staff version binds
`LVBT_NEWSLETTER_JOBS` to `lvbt-jobs-preview`. A different destination stops deployment. Launch mode
requires the active binding to match too.

The environment reviewer checks the selected build and approves that deployment. Wait for the
workflow's final configuration check and saved deployment receipt. Confirm that both selected
Workers are active. Retain the receipt privately with the build record; it is needed for recovery.

For a failed upload or activation, follow
[release recovery](../reference/staff-portal-operations.md#recover-a-failed-preview-activation).
Inspect actual active versions first. Resume activation with the same saved artifact and receipt
when its checks permit it; a new upload creates different versions and loses that recovery context.
The **Recover staff preview** workflow defaults to read-only inspection and uses the existing
protected environment. Choose **resume** only after the original receipt's inspection passes.

## 7. Complete first-administrator setup

Before the first sign-in, an authorized maintainer sets `LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL`
on `lvbt-staff-preview` to the approved tester's exact LVBT Google address. That Google account must
be linked to an active preview test membership. The secret chooses who may perform the one-time
setup; it does not itself grant administrator access.

1. Open <https://staff-preview.lasvegasfortransit.org/> in the LVBT Chrome profile.
2. Select **Sign in with Google** and use the approved LVBT account.
3. If asked to confirm membership, enter the email used for the preview membership record. It may be
   the same as the Google address. Enter the newest email code directly in that browser tab.
4. Select **Continue to staff**, then **Set up staff access** if shown.
5. Open **Members**, search for the test record, and open its profile.
6. Confirm the one-time administrator designation was audited. Remove the temporary setup secret
   after this succeeds.

To remove it in Cloudflare, open **lvbt-staff-preview → Settings → Variables and Secrets**. Find
`LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL`, select its **Delete** action, and choose **Delete &
Deploy** so the active preview stops receiving it. **Delete & Save** alone does not activate the
change. The dashboard may call this Worker's deployed environment **Production**; verify the Worker
name is still `lvbt-staff-preview` and its database is `lvbt-platform-preview` before saving. Do not
remove the Google sign-in or session-signing credentials. Confirm the setup secret is absent, sign
out, sign in again with the same Google account, and reopen the test profile. The administrator
designation must remain usable without returning to setup. Retain the resulting configuration change
in the private operational record, because it creates a new Worker version.

Keep one confirmation attempt open at a time. A newly requested code invalidates earlier unused
codes. Codes and linking attempts expire; if confirmation expires, sign in again and request a fresh
code. Passkeys and email codes must be completed by their owner.

## 8. Verify access before inviting testers

Follow [staff portal acceptance](../reference/staff-portal-acceptance.md). Test the approved
administrator, a committee lead, and an unapproved account. Check the actual preview on a phone,
with a keyboard, and with a screen reader. Keep provider writes and schedules disabled until their
separate live preview tests pass.

| Symptom                                                     | What it means                                                | Next step                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **Hello World!**                                            | A placeholder application is serving the hostname.           | Check custom-domain ownership and the selected active staff version.                             |
| Google sign-in succeeds but membership confirmation appears | The Google account has not been linked to the member record. | Confirm the preview membership email in the same browser attempt.                                |
| Confirmation expires                                        | The linking attempt or code is no longer current.            | Sign in again and request one fresh code.                                                        |
| Sign-in works but the member list is refused                | Membership, linking, or staff permission is incomplete.      | Inspect the approved preview record and one-time setup; do not infer permission from the domain. |
| Preflight says **unverified**                               | The checker could not prove a requirement.                   | Read the named check and repair its specific access or configuration dependency.                 |
| Deployment fails after upload                               | New versions may exist without full activation.              | Preserve the receipt, inspect both active deployments, and follow recovery before retrying.      |

Production deployment requires its own backup, migration review, provider acceptance, and launch
authorization. This setup procedure enables protected preview testing.
