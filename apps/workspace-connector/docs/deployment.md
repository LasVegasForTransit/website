# Deploy the Workspace connector

This service runs in Google Cloud Run. Activation requires separate approval of the exact IAM,
Workspace delegation, Scheduler, billing, and resource changes. Building or validating this package
alone does not authorize those changes.

Use separate preview and production Cloud Run identities. Configure `WORKSPACE_CONNECTOR_CONFIG`
with the reviewed JSON policy and `origin`, `siteAudience`, `schedulerSubject`, `serviceAccount`,
and `delegatedAdmin`. The delegated administrator must be `platform-admin@lasvegasfortransit.org`.
The service account must be a Google-managed attached runtime identity, with permission to invoke
`signJwt` only on the configured delegated service account. Never download a service-account key.

The policy contains the exact customer ID, human OU IDs, included/excluded user IDs, preview user
allowlist, Console group, committee registry, and complete production write registry. Preview write
groups must be disjoint from production groups, and preview discovery processes only the explicit
preview user IDs. Review the real OU mapping and complete human/service inventory before production
backfill. Directory returns OU paths; the connector resolves these to stable OU IDs.

Delegate only these Directory scopes to the restricted administrator:

- `https://www.googleapis.com/auth/admin.directory.user.readonly`
- `https://www.googleapis.com/auth/admin.directory.orgunit.readonly`
- `https://www.googleapis.com/auth/admin.directory.group.readonly`
- `https://www.googleapis.com/auth/admin.directory.group.member`

Build the image from the repository root using `apps/workspace-connector/Dockerfile`, through the
repository resource guard with an accurate external artifact and write estimate. The lockfile policy
check reads private LVBT package metadata, so pass an existing read-only package credential using
the following command:

```bash
docker buildx build \
  --secret id=npmrc,src="$HOME/.npmrc" \
  --secret id=npm_token,env=NODE_AUTH_TOKEN \
  -f apps/workspace-connector/Dockerfile .
```

The second secret supports an npmrc that references `NODE_AUTH_TOKEN`; it is unnecessary for a
credential file containing a literal token. BuildKit mounts this file only for dependency
installation; never copy credentials into the context, use a build argument for a token, or disable
the lockfile supply-chain check. Run
`pnpm --filter @lasvegasfortransit/workspace-connector preflight` with the reviewed configuration
before deploying. The container uses port 8080 and Node 24; it does not require a database
credential.

Configure a minute Google Scheduler POST heartbeat to `/run`, using its dedicated service account
with the exact configured subject and Cloud Run origin as OIDC audience. Every `/run` call verifies
Google signing, issuer, subject, audience, and expiry inside the application. Because Directory
notifications need a public webhook, Cloud Run IAM alone is not the route authorization boundary.

The public POST `/notifications` route requires a confirmed registered channel ID, resource ID,
event, and unpredictable validation token. It re-reads the immutable user ID from Directory before
sending an observation to the site. Notification content never grants access directly. Google watch
events are add, update, delete, and undelete. A missing account only defers to the explicit
deleted-user recovery scan; it never synthesizes deletion from a 404 or incomplete scan.

The site stores channel renewal claims, confirmed channel proofs, group leases, scan checkpoints,
and Google-only quota backoff. Watch renewal permits overlapping confirmed channels until expiry.
Each heartbeat processes one scan page or partial page, then bounded group work; a full active and
deleted scan becomes due every five minutes. Page offsets preserve progress when a deadline stops
processing within a page. The connector has a 45 second request deadline and five second individual
HTTP timeout, with no background writers or detached task loops.

Verify a preview account through the real Directory notification, portal sign-in, independent
Console membership readback, committee grant/removal, and Discord owner authorization. Separately
verify unauthenticated `/run`, wrong Scheduler subject/audience, invalid/expired channel proof,
expired ID tokens, quota pause, scan recovery, and the production group denial boundary. Do not
claim activation based on fixture tests or a successful container build.

For rollback, pause the Scheduler job and disable the connector endpoint/feature at the site. Stop
or let notification channels expire. Preserve account associations, additive schema, audit history,
and legitimate saved assignments. Do not bulk-remove unrelated group membership.

## Prepare an activation review

Run `pnpm --filter @lasvegasfortransit/workspace-connector preflight:google` to inspect billing,
APIs, service identities, Cloud Run and Scheduler without changing resources. Save the report in
private operator storage. Unavailable reads are gaps, not evidence that a resource is absent. A
normal Google Cloud CLI login may not carry Directory scopes: the Workspace customer, human OUs,
restricted administrator privileges and complete group registry need separate Admin Console or
approved Directory verification. Do not enable services to make a read-only inspection succeed.

Prepare deployment JSON containing `project` (`lvbt-core`), `region` (`us-central1`), `service`,
`image`, `runtimeSubject`, `schedulerAccount` and `connector` (the full runtime configuration). Use
`lvbt-workspace-preview` / `lvbt-workspace` for the service and attached service-account name, and
`lvbt-workspace-tick-preview` / `lvbt-workspace-tick` for the Scheduler account. Each service
account belongs to `lvbt-core`. Read actual numeric service-account unique IDs into `runtimeSubject`
and `connector.schedulerSubject`; these must differ. The image must be an immutable digest in
`us-central1-docker.pkg.dev/lvbt-core/workspace-connectors/`.

Run `pnpm --filter @lasvegasfortransit/workspace-connector deployment:plan <reviewed.json>`. It
validates separation and prints argument arrays for review; it never executes them. Its
prerequisites cover identity/repository creation, the runtime environment file, D1 and Workspace
setup. Verify existing resources before creating them. The signing custom role contains only
`iam.serviceAccounts.signJwt` and is bound on the exact attached service account, to itself. Do not
replace that with a project-wide Token Creator or Owner grant. The Scheduler identity gets no
Directory delegation or signing role. Retain the Cloud Scheduler service agent's standard job token
permission and the deployer's existing service-account attachment permission.

Store all four `LVBT_WORKSPACE_*` site settings as Worker secret bindings, including the enable
flag. Release promotion preserves secret bindings; manually added ordinary text bindings are not a
persistent configuration source. The generated plan defaults to disabled.

The public Cloud Run invoker binding is needed for Directory delivery. The application checks
registered channel proof for notifications and the exact Scheduler identity on `/run`; test both
before exposing production. Deployment uses request-based billing, zero minimum instances, one
maximum instance, one request per instance, one vCPU, 512 MiB and a 60 second HTTP timeout. The
application stops its owned work at 45 seconds. Do not allow detached work after the response. The
Scheduler must start paused until the site endpoint policy is ready; pause a newly created job
immediately if preparing it before activation. Keep the site's enabled flag false until preview
acceptance and production inventory review are complete.

At one heartbeat per minute, a 30-day month has 43,200 invocations. Five seconds of billable work
per invocation means about 216,000 vCPU-seconds and 108,000 GiB-seconds; the request-based free tier
may cover most compute when available. This is an estimate, not a cap: provider slowness,
notifications, cold starts and other services sharing the billing account affect actual charges. At
45 seconds per heartbeat, CPU alone can exceed
$40/month before free allowance. Artifact
storage, builds, logs and network transfer are separate. Scheduler costs $0.10/job/month
after its billing-account free allowance. Review
[Cloud Run pricing](https://cloud.google.com/run/pricing) and
[Scheduler pricing](https://cloud.google.com/scheduler/pricing), select the actual image/build path,
and approve a monthly operating allowance before running activation commands. No command here
enables billing, repairs payment, or authorizes hosted GitHub Actions spending.

## Activate required staff onboarding

Deploy compatible site, staff and jobs versions, and apply the additive migrations before enabling
Workspace observations. Keep `LVBT_STAFF_DISCORD_REQUIRED` false on the staff Worker during the
initial Directory backfill. Review the complete human-account scope, resolve unknown OUs and verify
that every current staff member has an active immutable Workspace association. Legacy staff without
an enrollment see setup-pending recovery when the required gate is enabled; existing elevated roles
do not bypass it.

In isolated preview, verify Account → Discord → Ready with a new team account and an existing member
account. Check cancellation, expired handoffs, account switching, server-rule screening and an
existing usable Discord connection. Confirm that directly opening a staff tool or submitting its
form cannot bypass setup, and that enrollment creates no committee assignments or newsletter
consent. Complete the real Discord check before enabling `LVBT_STAFF_DISCORD_REQUIRED=true` for
production. Treat the flag as a deployment rollout switch, not an individual exemption.

If the required gate prevents legitimate staff access because of a deployment or backfill defect,
restore the previous flag value while correcting the defect. Preserve identities, assignments,
consent and audit history. Do not fabricate a Discord confirmation or change someone's roles to
clear onboarding.

## Recover scanning and access

If recovery scanning stops, inspect the saved phase/checkpoint, Directory permissions and
Google-only backoff. Expired page tokens restart a lease-fenced scan; an incomplete scan must never
remove accounts by absence. A provider pause delays Google work while Discord and newsletter
scheduling continue independently. The connector reserves a separate daily D1 allowance and retains
conservative charges when usage metadata cannot be verified. Do not reset counters to bypass an
exhausted account quota.

The person's Accounts section separates Workspace account eligibility, connection to the person
record and provider-confirmed portal-group access. A queued retry does not claim access. An
administrator can request another Console check after correcting a permission or mapping failure;
this preserves provider-wide quota pauses. Unknown OUs require policy review, and inherited group
access requires resolving its source. Never broaden a group registry merely to clear an error.

Successful Console memberships are rechecked daily; fresh Directory eligibility changes and explicit
administrator retries schedule work immediately. Historical confirmation stays labelled as such
after its freshness window. This avoids an hourly full-staff rewrite cycle. Minute heartbeats
combine maintenance reads and skip group claims when no work is due. Google has independent D1 daily
ceilings of 750,000 reads / 25,000 writes in production and 75,000 / 12,000 in preview. These leave
the existing scheduled-provider reservations intact; review measured account volume and
initial-backfill cost before activation rather than raising limits to bypass quota pressure.
