# Deployment pipeline

GitHub Actions builds one release from `main`, deploys it to protected staging, and stores its files
for explicit production promotion. Merging a pull request updates staging; it does not publish the
public website.

## Hosts and environments

| Host                                                      | Worker                             | Data                    | Update trigger             |
| --------------------------------------------------------- | ---------------------------------- | ----------------------- | -------------------------- |
| `lasvegasfortransit.org` and `www.lasvegasfortransit.org` | `lvbt-website`                     | `lvbt-platform`         | Explicit promotion         |
| `preview.lasvegasfortransit.org`                          | `lvbt-website-preview`             | `lvbt-platform-preview` | Successful main build      |
| Versioned PR Worker URLs                                  | Versions of `lvbt-website-preview` | `lvbt-platform-preview` | Same-repository PR updates |

Staging and PR previews share a preview database. They do not have a separate database per PR.
Production secrets remain bound to the production Worker. Preview integrations need separate test
credentials; missing credentials make affected endpoints unavailable. Promotion moves code and
assets, never databases or test records.

The former Pages project remains at `lvbt-website-5zh.pages.dev` as an older public recovery option.
New Pages PR deployments are disabled so they cannot expose an unprotected copy of private work.

## Build and artifact contract

`pnpm check` covers the repository standard, formatting, lint, types, tests, documentation links,
production build, generated Worker types, Wrangler dry run, and local Worker parity. `pnpm build`
writes static assets and Pagefind to `apps/site/dist/` and compiled Pages Functions to
`apps/site/.wrangler/worker/`.

`Deploy staging` retains a `website-release-<run-id>` Actions artifact for 90 days. It contains only
the compiled Worker, static assets, Wrangler configuration, and `release.json`. The manifest records
the commit, release ID, sorted file inventory, and SHA-256 hashes. The `/lvbt-release.json` response
identifies the deployed release. Prototype routes and the audit-only language cannot enter a
promotable artifact.

Promotion downloads this artifact from its originating run, verifies its identity and all files, and
uploads a temporary copy with bundling disabled. It performs no site or Worker rebuild. Production
and staging have different Worker version IDs because their bindings differ; their compiled code and
asset files come from the same artifact.

## Cloudflare Access

The preview Worker must have a Worker-specific Access policy covering **All traffic**. This covers
the custom staging domain and versioned PR URLs without protecting unrelated public Workers. Staff
authenticate with the existing LVBT staff identity policy. Automation uses a dedicated Access
service token in a **Service Auth** policy attached only to this Worker.

The `worker-preview` GitHub environment supplies:

| Secret                         | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `CLOUDFLARE_WORKERS_API_TOKEN` | Upload and activate preview versions          |
| `CF_ACCESS_CLIENT_ID`          | Identify the preview verification service     |
| `CF_ACCESS_CLIENT_SECRET`      | Authenticate the preview verification service |

`CLOUDFLARE_ACCOUNT_ID` remains a repository variable. Access credentials are supplied only to the
specific preview origin. HTTP verification disables automatic redirects; browser verification
fetches authenticated responses without following redirects, then lets the browser navigate the
returned response. Third-party origins receive no Access headers.

Preview responses carry `X-Robots-Tag: noindex, nofollow, noarchive` and
`Cache-Control: private, no-store`. Preview runs the Worker before every asset request to apply
those headers. Production uses selective Worker routing for application endpoints and ordinary asset
delivery for static pages. The shared analytics package enables tracking only on the public apex and
`www` hostname, so the production-shaped artifact sends no analytics on staging or PR URLs.

A failed staging job can be retried with **Re-run failed jobs**. Each run ID identifies one
immutable artifact; **Re-run all jobs** cannot replace an artifact that already exists. Dispatch a
new staging run when a rebuild is needed.

## Main and PR deployment

Main pushes and scheduled calendar rebuilds run `Deploy staging`. The workflow validates and saves
the artifact, uploads a preview version, checks anonymous denial and authenticated browser
rendering, runs browser contract checks, activates that exact preview version, and checks the
permanent staging hostname. Its summary records the release, commit, version, and originating run.

Same-repository PRs use `Deploy Worker preview` when `CLOUDFLARE_WORKERS_PREVIEW_ENABLED=true`. It
uploads a preview version, verifies Access and browser contracts, and comments its URL on the PR. PR
uploads never activate a version or move the permanent staging domain. Forks receive no Cloudflare
or Access secrets. PRs may include preview-only prototype pages; those builds cannot be promoted.

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
revision, so fixes to promotion tooling also apply to older retained releases.

The workflow verifies the selected artifact and every file, uploads without rebuilding, verifies its
production candidate marker and browser contracts, and activates its exact Worker version. Candidate
checks require the expected marker immediately. After activation, the permanent domain may propagate
for up to 180 seconds, polling every five seconds with bounded requests. Authentication failures
stop immediately. Public verification checks the selected marker, browser rendering, a nested route,
and the `www` redirect. Staging and main may advance without changing selection.

The existing `worker-candidate` environment supplies the production Workers token. Its historical
name is retained to reuse the established credential scope. Environment reviewers may provide an
additional publication gate; the command reports a waiting run with its URL. Nothing automatically
dispatches production promotion.

Each promotion retains `publication-<promotion-run-id>-<attempt>` for 90 days, including the
baseline public release, selected source, artifact hash, uploaded version, activation outcome, and
public verification outcome. The receipt and summary are written even after a failed activation or
public check. Confirmed activation with failed verification means production may already have
changed. A failed activation has an unknown outcome until reconciled. Inspect the exact run and live
identity before taking another publication action; do not automatically redispatch or roll back.

The command supplies a unique request ID. If the dispatch response is lost, it finds only that
request's run. An unconfirmed dispatch or timed-out run reports its ID/URL and stops without a
second dispatch.

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
