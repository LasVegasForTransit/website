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

`Promote website release` accepts the originating **Actions run ID**, and runs only from `main`. It
requires a completed, successful `Deploy staging` run from this repository on `main`, triggered by a
push or manual dispatch. PR runs, old automatic production runs, failed runs, and foreign
repositories are rejected.

The workflow downloads the selected run's artifact, verifies it against the recorded commit, uploads
a production candidate, checks its release marker and browser contracts, and activates its exact
version ID. It then checks the public release marker and rendered page. Staging and `main` may
advance during this process without changing the selected artifact.

The existing `worker-candidate` GitHub environment supplies the production Workers token. Its
historical name is retained to reuse the established credential scope. Environment reviewers may
provide an additional publication gate. Dispatching this workflow is the explicit publication
request; nothing automatically dispatches it.

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
