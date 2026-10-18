# Deployment pipeline

An explicit staging dispatch, including the existing calendar refresh, builds one release from
`main`, deploys it to protected staging, and stores its files for explicit production promotion.
Merging a pull request runs source checks and saves staff build artifacts without updating retained
staging or publishing the public website.

## Hosts and environments

| Host                                                      | Worker                             | Data                    | Update trigger             |
| --------------------------------------------------------- | ---------------------------------- | ----------------------- | -------------------------- |
| `lasvegasfortransit.org` and `www.lasvegasfortransit.org` | `lvbt-website`                     | `lvbt-platform`         | Explicit promotion         |
| `preview.lasvegasfortransit.org`                          | `lvbt-website-preview`             | `lvbt-platform-preview` | Staging workflow dispatch  |
| Versioned PR Worker URLs                                  | Versions of `lvbt-website-preview` | `lvbt-platform-preview` | Same-repository PR updates |

Staging and PR previews share a preview database. They do not have a separate database per PR.
Production secrets remain bound to the production Worker. Preview integrations need separate test
credentials; missing credentials make affected endpoints unavailable. Promotion moves code and
assets, never databases or test records.

The former Pages project remains at `lvbt-website-5zh.pages.dev` as an older public recovery option.
New Pages PR deployments are disabled so they cannot expose an unprotected copy of private work.

## Build and artifact contract

`pnpm check` covers the repository standard, formatting, lint, types, tests, documentation links,
production build, generated Worker types, Wrangler dry run, local Worker parity, and the exhaustive
`ui-contracts` browser project against the local compiled Worker. Install Chromium with
`pnpm -C apps/site test:install` before checking locally. Required validation always starts its own
local Worker, overriding any remote browser URL. The root `pnpm build` command also requires those
local contracts before packaging. Both commands share a Turbo task keyed to source, built assets and
compiled Worker contents, so identical checked bytes can reuse the local result. Changed build
outputs require another pass. `pnpm build` writes static assets and Pagefind to `apps/site/dist/`
and compiled Pages Functions to `apps/site/.wrangler/worker/`.

`Deploy staging` calls the shared build workflow with required analytics and the site's existing
browser acceptance checks. New artifacts use `apps/deploy/cloudflare.config.ts` as their canonical
typed configuration. The shared adapter bundles the existing compiled Pages Functions entry point,
preserves both production domains and preview settings, and retains a `website-release-<run-id>`
Actions artifact for 90 days. It contains the compiled Worker, static assets, reviewed configuration
and binding declarations, exact database migration SQL, and `release.json`. The manifest records the
commit, release ID, sorted file inventory, and SHA-256 hashes. The `/lvbt-release.json` response
identifies the deployed release. Prototype routes and the audit-only language cannot enter a
promotable artifact.

Promotion downloads this artifact from its originating run, verifies its identity and all files, and
uploads a temporary copy with bundling disabled. It performs no site or Worker rebuild. Production
and staging have different Worker version IDs because their bindings differ; their compiled code and
asset files come from the same artifact.

The shared migration step applies the saved SQL to the selected preview or production database
before activation. It never reads newer checkout SQL during promotion. A failed migration may have
applied earlier files; inspect the selected database's migration history before retrying. The
existing artifact reader continues to accept older retained releases without a migration inventory;
it cannot substitute current SQL for missing reviewed SQL.

## Cloudflare Access

The preview Worker must have a Worker-specific Access policy covering **All traffic**. This covers
the custom staging domain and versioned PR URLs without protecting unrelated public Workers. Staff
authenticate with the existing LVBT staff identity policy. Automation uses a dedicated Access
service token in a **Service Auth** policy attached only to this Worker.

The `worker-preview` GitHub environment supplies:

| Secret                            | Purpose                                       |
| --------------------------------- | --------------------------------------------- |
| `CLOUDFLARE_WORKERS_API_TOKEN`    | Upload and activate only the preview Worker   |
| `CLOUDFLARE_MIGRATIONS_API_TOKEN` | Apply retained preview schema migrations      |
| `CF_ACCESS_CLIENT_ID`             | Identify the preview verification service     |
| `CF_ACCESS_CLIENT_SECRET`         | Authenticate the preview verification service |

`CLOUDFLARE_ACCOUNT_ID` is an environment variable in each release environment. Access credentials
are supplied only to the specific preview origin or a version URL under the configured
`las-vegas-for-better-transit.workers.dev` account suffix. Another account's Worker with the same
name is rejected before authentication. Public production candidates and local browser checks
receive no Access service credentials. HTTP verification disables automatic redirects; browser
verification fetches authenticated responses without following redirects, then lets the browser
navigate the returned response. Third-party origins receive no Access headers.

Preview responses carry `X-Robots-Tag: noindex, nofollow, noarchive` and
`Cache-Control: private, no-store`. Preview runs the Worker before every asset request to apply
those headers. Production uses selective Worker routing for application endpoints and ordinary asset
delivery for static pages. The shared analytics package enables tracking only on the public apex and
`www` hostname, so the production-shaped artifact sends no analytics on staging or PR URLs.

Hosted acceptance checks these protections on site pages and assets. Cloudflare's
[`/cdn-cgi/` infrastructure](https://developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint/)
is served outside the Worker. Only the exact `/cdn-cgi/speculation` response, classified by the
browser as `other` with the speculation-rules JSON content type, is excluded from those header
assertions. Its HTTP status, request allowance, and redirect checks still apply.

A failed staging job can be retried with **Re-run failed jobs**. Each run ID identifies one
immutable artifact; **Re-run all jobs** cannot replace an artifact that already exists. Dispatch a
new staging run when a rebuild is needed.

## Main and PR deployment

Main pushes run source checks and save staff build artifacts without starting retained staging.
`Deploy staging` requires a workflow dispatch on `main`; the existing scheduled calendar rebuild
also dispatches it. This avoids migrations and staging publication for unrelated source changes.
Before a manual dispatch, verify preview database quota and migration readiness. The workflow still
validates, saves and signs the artifact, applies its retained preview schema, uploads a preview
version, checks anonymous denial and authenticated browser rendering, runs bounded hosted
acceptance, activates that exact preview version, and checks the permanent staging hostname. Its
summary records the release, commit, version, and originating run.

Same-repository PRs use `Deploy Worker preview` when `CLOUDFLARE_WORKERS_PREVIEW_ENABLED=true`. This
build has a read-only GitHub token, no release environment, and no Cloudflare or Access credentials.
It validates the PR and retains compiled Worker and asset bytes for seven days.

`Publish Worker preview` runs separately from trusted `main` on successful build completion. It
checks the source workflow, repository, current open PR, full commit, artifact identity and hashes.
It uploads those bytes with configuration and preview bindings from `main`, then runs the trusted
smoke and browser checks and updates the PR comment. It never imports PR code, runs PR migrations,
or uses PR deployment configuration on the credentialed runner. File and computed module imports are
rejected before upload. The build payload cannot be promoted to production.

Staging, PR publication and production promotion select the `hosted-acceptance` browser project. Its
single test checks the marker, rendered assets, mobile navigation, a nested route and the
missing-page response. Publication verification reserves 20 requests for candidate smoke, 64 for
hosted acceptance, and 32 for activated-origin smoke: at most 116 requests across all three stages.
PR publication uses only the first two stages, for at most 84. The production workflow also performs
four fixed precondition reads outside those stages, so its maximum is 120. Using `pnpm promote` adds
one completion-marker read outside the workflow. Provider administration API calls do not invoke the
website Worker and are outside these counts.

Each stage counts direct marker/access/navigation checks and every browser resource before sending
it, and aborts excess requests. Test and network retries are zero. Candidate identity is read once;
activation can read identity at most five times over 20 seconds, within its 32-request allowance.
Unexpected browser redirects fail without following them. Public smoke renders the actual root in a
browser and checks the nested route and canonical `www` redirect with non-following HTTP requests;
hosted acceptance also verifies real browser navigation to a nested page. Every publication still
fails when any required check fails. Access denial, private cache and indexing headers, analytics
isolation and selected-release identity remain required.

After the shared build packages and retains one artifact, a required local job downloads that exact
run artifact and verifies its commit, release ID, manifest and file hashes. It runs exhaustive
`ui-contracts` against a byte-identical disposable copy of the packaged Worker with its retained
preview configuration and sitemap/HTML, using local bindings and no rebundling. It verifies the
input and runtime copy remain unchanged afterward. Main attestation depends on this job, and the
entire PR build workflow must pass before the trusted publisher accepts its payload. The validated
bytes are the bytes retained for publication; this gate performs no build or repackaging.

Both `worker-preview` and `worker-candidate` accept only the selected branch `main`. The preview
publisher receives the preview Worker's deployment token and supplies Access credentials only to
verification steps. Worker deployment tokens use **Individual Workers Editor** and **Individual
Workers Metadata Read-Only**, each scoped to their one existing Worker. The metadata permission lets
promotion read the current deployment before activation; editor access alone may not permit this
read. Schema migration steps receive a separate `CLOUDFLARE_MIGRATIONS_API_TOKEN` with the minimum
D1 write permission Cloudflare supports; account-wide D1 access remains a separate privilege. No
provider credentials belong at repository scope.

PR uploads never activate a version or move the permanent staging domain. Fork PRs are not uploaded.
PRs may include preview-only prototype pages. Preview and staging still share the preview database;
PR Worker code may act on that test database, so preview must contain only test data and
credentials.

## Production promotion

`pnpm promote` dispatches `Promote website release` from `main`, tracks that exact request, waits
for the publication receipt, and verifies the live public marker. It requires `gh` authentication
with repository Actions write access. The operator does not need local Cloudflare credentials or an
authenticated preview browser. The same workflow can be dispatched in GitHub without inputs. An
explicit request to promote is the publication authorization; a new screenshot review is needed only
when requested as part of that task.

By default, the workflow reads the authenticated marker currently served by preview, using the
existing `worker-preview` environment's Access service credentials. It pins that identity once, then
validates its successful main `Deploy staging` run, matching full commit SHA and retained artifact.
If preview was just activated, it waits for that same staging run's final checks to finish. It never
substitutes the newest main commit or run. An optional `run_id` input selects a specific reviewed
release; the command accepts it as `pnpm promote --run-id <id>`.

The source must be a completed, successful main staging run from this repository, triggered by a
push or manual dispatch. PR runs, failed runs, foreign repositories, missing artifacts, and expired
artifacts are rejected. Both jobs use trusted verification tools from the dispatched workflow
revision, so fixes to promotion tooling also apply to older retained releases. The manifest lists
the exact 16 unexpired unsigned releases retained at attestation adoption, with their run ID, source
commit, artifact ID and original expiry. The shared verifier downloads and checks their retained
bytes and remote provenance before accepting them. New artifacts require signed proof; this bounded
compatibility does not extend retention or permit replacement artifacts.

The optional `expected_version` dispatch input prevents publication if the active production Worker
version changes. First adoption requires this reviewed current version when production has no shared
release marker. The command accepts it as `pnpm promote --expected-version <version-id>`. The shared
publication receipt records the provider-version baseline.

The workflow verifies the selected artifact and every file, uploads without rebuilding, verifies its
production candidate marker and browser contracts, and activates its exact Worker version. Candidate
checks require the expected marker immediately. After activation, the permanent domain may propagate
for up to 20 seconds, with at most five marker reads included in activated smoke's fixed allowance.
Authentication failures stop immediately. Public verification checks the selected marker, browser
rendering, a nested route, and the `www` redirect. Staging and main may advance without changing
selection.

The existing `worker-candidate` environment supplies the production Workers token. Its historical
name is retained. It supplies a per-Worker production deployment token and a separate D1 migration
credential. Repository write and Actions access authorize dispatch; provider administration is
needed only when maintainers first install or rotate those credentials. Bootstrap preserves the
selected-main branch restriction and existing approval rules. Environment reviewers may provide an
additional publication gate; the command reports a waiting run with its URL. Nothing automatically
dispatches production promotion.

If the current-deployment lookup returns **No access to the specified resource**, check the token in
Cloudflare before starting another promotion:

1. Open **Manage account → Account API tokens** and select the existing production website
   deployment token.
2. Confirm **Individual Workers Editor** and **Individual Workers Metadata Read-Only** both name
   only `lvbt-website`. Keep the existing expiration and other restrictions. Obtain authorization
   before adding a missing permission; account-wide metadata access is unnecessary for this lookup.
3. Review and save the authorized change, then reopen the token to confirm both scopes. Do not reset
   the token or replace the value stored in GitHub merely to change its permissions.
4. Inspect the failed promotion's retained receipt and the current active version before recovery. A
   failure before activation leaves production unchanged. Follow the exact run's recovery path;
   never dispatch a replacement while activation has an unknown outcome.

Each promotion retains `publication-<promotion-run-id>-<attempt>` for 90 days, including the
baseline public release, selected source, artifact hash, uploaded version, activation outcome, and
public verification outcome. The receipt and summary are written even after a failed activation or
public check. Confirmed activation with failed verification means production may already have
changed. A failed activation has an unknown outcome until reconciled. Inspect the exact run and live
identity before taking another publication action; do not automatically redispatch or roll back.

The command supplies a unique request ID. If the dispatch response is lost, it finds only that
request's run. An unconfirmed dispatch or timed-out run reports its ID/URL and stops without a
second dispatch.

### Diagnose dashboard metadata failures

When Wrangler reports **Unable to fetch bindings, routes, or services metadata from the dashboard**,
first inspect the failed promotion's receipt and the current Worker version. This error alone does
not establish whether production changed. Do not retry publication until its outcome is reconciled.

For a failure before upload, run **Inspect website deployment metadata** from `main` in GitHub
Actions. It uses the existing `worker-candidate` environment and the same website deployment key as
promotion. The workflow makes one read-only request to each of Wrangler's six dashboard metadata
endpoints for `lvbt-website`: bindings, routes, custom domains, subdomain settings, environment
metadata, and schedules. It does not deploy, migrate, change settings, or retry requests.

Read the diagnostic step's result for each resource. It reports only HTTP status, success, and
numeric Cloudflare error codes; provider response data and credentials are never printed. All
resources must succeed. A denied resource identifies the boundary to investigate with Cloudflare's
permission documentation or support. Do not broaden the deployment key based on the generic error,
replace it with another service's key, or disable Wrangler's configuration-conflict check.

After correcting the identified prerequisite, reconcile the failed promotion again and follow the
recorded release's supported recovery path. Keep its selected artifact and current-version guard.

## Manual recovery deployment

`pnpm run deploy` builds the site and uses `cf` with the typed configuration in
`apps/deploy/cloudflare.config.ts`. Set `CLOUDFLARE_ACCOUNT_ID` in the deployment environment.
Generate the local and recovery mirror with `pnpm -C apps/deploy compat:generate` after changing the
canonical configuration or its declarations in `.lvbt/tooling.json`. The shared generator writes
`apps/site/wrangler.jsonc`, including separate databases, runtime variables, migration paths, and
Worker-first routes. Do not edit this mirror directly. Application secrets must already be stored on
the selected Worker; this command does not create them.

Use `pnpm run deploy --dry-run` to review the production bundle without uploading it. Preview mode
uses `pnpm -C apps/deploy exec cf deploy --mode preview --dry-run` after the site is built. Normal
releases continue through staging and the reviewed-version promotion workflow described above.

## Scheduled link audit

The weekly audit checks internal links against its own compiled local Worker, including relative
links, absolute apex/`www` links, redirect routes, and generated calendar endpoints. Those URLs are
not checked against a potentially older public deployment. Genuine external links, including
external redirect destinations, remain in the lychee check alongside repository Markdown. Local
document links also retain the existing `check:docs` gate. Broken links still fail the workflow.

## Rollback

A previous successful staging run can be promoted again while its artifact is retained. For urgent
Worker recovery, use `wrangler rollback <version-id>` with the recorded production version and
verify both public hostnames. Deleted or incompatible data bindings can prevent rollback; schema
migrations require separate compatible rollout planning.

If the Worker itself cannot serve traffic, restoring the older Pages project requires a separate
routing decision and DNS/custom-domain changes. Normal release rollback changes no domains. Expired
Actions artifacts cannot be silently rebuilt and presented as reviewed releases. Build a new release
and review it, or use an already recorded compatible Worker version.

## Caching and external content

Production HTML revalidates; hashed assets retain their existing immutable cache headers. Staging is
private and does not cache responses. Calendar, newsletter, and other build-time content is captured
in the saved release. Scheduled refreshes update staging only; public content becomes current when
an updated release is promoted.
