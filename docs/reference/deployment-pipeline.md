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

The `Deploy Worker preview` workflow runs when the repository variable `CLOUDFLARE_WORKERS_PREVIEW_ENABLED` is `true`. Its token comes only from the `worker-preview` GitHub environment. The workflow uploads a Worker version without deploying it, verifies the versioned preview URL, and updates one pull request comment. Forks never receive the token.

The preview environment contains:

| Setting                              | Kind                | Purpose                                                       |
| ------------------------------------ | ------------------- | ------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`              | variable            | Selects the LVBT Cloudflare account                           |
| `CLOUDFLARE_WORKERS_API_TOKEN`       | secret              | Uploads versions for `lvbt-website` without editing zones     |
| `CLOUDFLARE_WORKERS_PREVIEW_ENABLED` | repository variable | Enables the candidate workflow after credentials are verified |

Application secrets bind directly to the Worker before endpoint acceptance. Build-time `PUBLIC_LVBT_*` variables remain GitHub Actions variables and are included in the generated HTML.

## Production

`Deploy production` publishes `dist/` to the `lvbt-website` Pages project from `main`. The custom hostnames `lasvegasfortransit.org` and `www.lasvegasfortransit.org` remain attached to Pages through the acceptance period.

Workers cutover requires a candidate built from the current `main` commit and a recorded previous Pages deployment. DNS, TLS, redirects, headers, analytics, static pages, 404 handling, and every API route are checked against the version preview before the hostname route changes. The Pages project stays available until the Worker passes the same checks on the production hostname.

## Rollback

Before cutover, rollback selects the preceding successful Pages deployment. After cutover, `wrangler rollback <VERSION_ID> --message <reason>` creates a deployment that sends all Worker traffic to the recorded version. Route and DNS configuration stay unchanged.

The rollback version must retain every binding used by that release. Deleted or incompatible storage bindings prevent Cloudflare from applying an older version.

## Caching

HTML revalidates on every request. Astro gives changed static assets new hashed filenames, while `_headers` assigns long-lived immutable caching to `/_astro/*` and `/fonts/*`. Normal releases do not require a cache purge.
