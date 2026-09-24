# Deployment pipeline

GitHub Actions owns builds and deployment. A change is built from a clean checkout, validated, and sent to Cloudflare with the package and Wrangler versions recorded in the repository.

Cloudflare Pages remains the production origin during the Workers acceptance period. The Workers candidate uses the same Astro output, Pages Functions, headers, redirects, and hostname contract. No production route points to the Worker before the live checklist passes.

## Build contract

`pnpm build` creates the static site in `dist/`, builds the Pagefind index, and compiles `functions/` into `.wrangler/worker/index.js`. Wrangler serves the static tree through the `ASSETS` binding and invokes the Worker first only for `/api/*`.

`pnpm check` covers the vendored LVBT standard, formatting, lint, type checks, unit tests, documentation links, the production build, generated Worker binding types, a Wrangler dry run, and local Worker parity. The parity check starts the built Worker on an unused local port and verifies:

- the home page and branded 404 response;
- security headers and the calendar MIME override;
- the permanent `/get-involved` redirect;
- execution of the compiled subscription API.

The checked configuration lives in `wrangler.jsonc`. It exposes no custom domain or route, so uploading a candidate cannot move production traffic.

## Pull requests

Every pull request receives ordinary validation. Same-repository pull requests also receive the existing Pages preview.

The `Deploy Worker preview` workflow runs when the repository variable `CLOUDFLARE_WORKERS_PREVIEW_ENABLED` is `true`. Its token comes only from the `worker-preview` GitHub environment. The workflow uploads a version of the separate `lvbt-website-preview` Worker without deploying it. That Worker is the `preview` environment in `wrangler.jsonc` and uses the preview platform database, so test data never reaches the production database. The workflow verifies the versioned preview URL, compares its HTTP contract with Pages, runs the Playwright accessibility and visual suites against the edge deployment, and updates one pull request comment. Forks never receive the token.

The preview environment contains:

| Setting                              | Kind                | Purpose                                                                                                                                                                                                      |
| ------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLOUDFLARE_ACCOUNT_ID`              | repository variable | Selects the LVBT Cloudflare account. It is a repository variable, not scoped to this environment, because jobs with no environment of their own (the fork-safety check in `deploy-preview.yml`) also read it |
| `CLOUDFLARE_WORKERS_API_TOKEN`       | environment secret  | Uploads versions for `lvbt-website` and `lvbt-website-preview` without editing zones                                                                                                                         |
| `CLOUDFLARE_WORKERS_PREVIEW_ENABLED` | repository variable | Enables the candidate workflow after credentials are verified                                                                                                                                                |

See [test the Workers candidate](../guides/test-the-workers-candidate.md) for the exact clicks to create the environment and its token.

Application secrets bind directly to the Worker before endpoint acceptance. Build-time `PUBLIC_LVBT_*` variables remain GitHub Actions variables and are included in the generated HTML.

## Platform database

The Organizing Platform keeps its data in Cloudflare D1 (a SQL database; see the [glossary](./glossary.md#d1)). Code reaches it through the `PLATFORM_DB` [binding](./glossary.md#binding), which `wrangler.jsonc` points at a different database for each Worker:

| Worker                 | Used by                                       | Database                |
| ---------------------- | --------------------------------------------- | ----------------------- |
| `lvbt-website`         | production, and the `main` candidate versions | `lvbt-platform`         |
| `lvbt-website-preview` | pull request previews                         | `lvbt-platform-preview` |

Both databases are on the free plan in Western North America. `pnpm dev` and `pnpm worker:dev` use a local copy that Wrangler keeps in `.wrangler/`, so local work never touches either one. The [platform decision record](../explanation/decisions/organizing-platform.md) explains why there is one database.

## Production

`Deploy production` builds `main`. While `LVBT_WORKERS_PRODUCTION_ENABLED` is unset, it also publishes `dist/` to the `lvbt-website` Pages project. Pages remains the fallback origin during Worker acceptance.

Its `deploy` job declares `environment: production`, but that only makes the deployment show up under the repository's **Environments** tab with its own history — add required reviewers under **Settings → Environments → production** if you want a manual approval gate there. The two values it needs are plain repository-level settings, not scoped to that one environment, because `deploy-preview.yml`'s fork-safety job (which has no environment of its own) also reads them:

| Setting                 | Kind                | Purpose                                                                                                                                                                                           |
| ----------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | repository variable | Selects the LVBT Cloudflare account; not secret, so its value is shown in plain text wherever GitHub lists variables                                                                              |
| `CLOUDFLARE_API_TOKEN`  | repository secret   | Deploys to Cloudflare Pages (`wrangler pages deploy`); shared with `deploy-preview.yml`'s `preview` environment job, so it must stay a repository secret rather than move into either environment |

Create the token: open `https://dash.cloudflare.com/<account-id>/api-tokens`, click **Create Token**, then **Create Custom Token** → **Get started** (Cloudflare has no ready-made template for Pages alone). Under **Permissions**, add one row: **Account · Cloudflare Pages · Edit**. Under **Account Resources**, choose **Include** and the LVBT account, not "All accounts". Leave **Zone Resources** at its default — this token needs no zone permission. Leave the TTL empty so deploys keep working. Click **Continue to summary**, then **Create Token**, and copy it: Cloudflare shows it only once. Store it with `gh secret set CLOUDFLARE_API_TOKEN` (paste the value at the prompt; never pass it as a command-line argument). Store the account ID, which is not secret, with `gh variable set CLOUDFLARE_ACCOUNT_ID`.

After a successful production build, `Deploy Worker candidate` uploads the same `main` commit as a
versioned Worker when `CLOUDFLARE_WORKERS_CANDIDATE_ENABLED` is `true`. Before cutover it compares
the candidate with Pages. It then runs the browser acceptance suite and records the commit, Worker
version, and preview URL in the workflow summary. With `LVBT_WORKERS_PRODUCTION_ENABLED` unset, the
workflow only uploads a version and does not edit a route or create a deployment.

With `LVBT_WORKERS_PRODUCTION_ENABLED` set to `true`, the workflow skips the comparison with the
older Pages fallback, confirms that `main` still points at the verified commit, and deploys that
exact Worker version. It then compares the production hostname with the version preview. The
preview excludes analytics, so this final comparison checks responses but not analytics insertion.

The `worker-candidate` environment needs its own `CLOUDFLARE_WORKERS_API_TOKEN` environment secret
(create it the same way as `worker-preview`'s, in [test the Workers
candidate](../guides/test-the-workers-candidate.md)) and reads the same `CLOUDFLARE_ACCOUNT_ID`
repository variable as `worker-preview`. Giving each environment its own token means rotating one
never touches the other. A manual run is accepted only from `main`.

Workers cutover requires a candidate built from the current `main` commit and a recorded Pages
deployment. DNS, TLS, redirects, headers, analytics, static pages, 404 handling, and every API
route are checked against the version preview before the hostname route changes. The Pages project
stays available until the Worker passes the same checks on the production hostname.

## Rollback

Before cutover, rollback selects the preceding successful Pages deployment. During the route
overlay, removing the two website Worker routes immediately returns traffic to the Pages fallback.
For a Worker-only release regression, `wrangler rollback <VERSION_ID> --message <reason>` sends all
Worker traffic to the recorded version without changing routes or DNS.

The rollback version must retain every binding used by that release. Deleted or incompatible storage bindings prevent Cloudflare from applying an older version.

## Caching

HTML revalidates on every request. Astro gives changed static assets new hashed filenames, while `_headers` assigns long-lived immutable caching to `/_astro/*` and `/fonts/*`. Normal releases do not require a cache purge.
