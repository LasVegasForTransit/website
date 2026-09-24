# Deployment pipeline

GitHub Actions owns builds and deployment. A change is built from a clean checkout, validated, and sent to Cloudflare with the package and Wrangler versions recorded in the repository.

The `lvbt-website` Worker serves `lasvegasfortransit.org` and `www.lasvegasfortransit.org` through Cloudflare custom domains. The former Pages project stays available at `lvbt-website-5zh.pages.dev` as a rollback artifact; it owns neither public hostname.

## Build contract

`pnpm build` creates the static site in `dist/`, builds the Pagefind index, and compiles `functions/` into `.wrangler/worker/index.js`. Wrangler serves the static tree through the `ASSETS` binding and invokes the Worker first only for `/api/*`.

`pnpm check` covers the vendored LVBT standard, formatting, lint, type checks, unit tests, documentation links, the production build, generated Worker binding types, a Wrangler dry run, and local Worker parity. The parity check starts the built Worker on an unused local port and verifies:

- the home page and branded 404 response;
- security headers and the calendar MIME override;
- the permanent `/get-involved` redirect;
- execution of the compiled subscription API.

The checked Worker configuration lives in `wrangler.jsonc`. Production custom domains are attached to the existing Worker in Cloudflare. Version uploads do not change those domains, and the deployment token cannot edit DNS or routes.

## Pull requests

Every pull request receives ordinary validation. Same-repository pull requests also receive Pages and Worker previews.

The `Deploy Worker preview` workflow runs when the repository variable `CLOUDFLARE_WORKERS_PREVIEW_ENABLED` is `true`. Its token comes only from the `worker-preview` GitHub environment. The workflow uploads a version of the separate `lvbt-website-preview` Worker without deploying it. That Worker is the `preview` environment in `wrangler.jsonc` and uses the preview platform database, so test data never reaches the production database. The workflow verifies the versioned preview URL, runs the Playwright accessibility and visual suites against the edge deployment, and updates one pull request comment. Forks never receive the token. The Pages comparison runs only when Workers production is disabled.

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

`Deploy production` builds `main`. With `LVBT_WORKERS_PRODUCTION_ENABLED=true`, its Pages job is skipped. The Pages project remains online at its `pages.dev` address but receives no new production builds.

After a successful build, `Deploy Worker candidate` uploads the same `main` commit as a versioned Worker. It runs the browser acceptance suite, records the commit, version, and preview URL, and confirms that `main` still points at the verified commit before deploying that version. The final check compares the production hostname with the version preview. A manual run is accepted only from `main`.

The `worker-candidate` GitHub environment contains `CLOUDFLARE_WORKERS_API_TOKEN`, scoped to the LVBT account with Workers Scripts Edit permission. It reads the account ID from the repository-level `CLOUDFLARE_ACCOUNT_ID` variable. The separate `worker-preview` environment has its own token. Neither token can change zone DNS or Worker routes. The repository-level `CLOUDFLARE_API_TOKEN` remains for Pages pull request previews; it is not used for production Worker deployment.

Cloudflare owns the DNS records and certificates for the two Worker custom domains. The former `/*` overlay routes and Pages custom-domain associations are absent. The Pages deployment remains reachable through its `pages.dev` address for emergency recovery.

## Rollback

For a Worker release regression, `wrangler rollback <VERSION_ID> --message <reason>` sends all Worker traffic to the recorded version without changing custom domains or DNS. Verify both public hostnames afterward.

If the Worker itself cannot serve traffic, remove each Worker custom domain, restore the Pages custom-domain association and its proxied Pages CNAME, then verify TLS and the site contract on both hostnames. The Pages deployment remains accessible at `lvbt-website-5zh.pages.dev` throughout this procedure. Restoring Pages changes routing and requires a separate incident decision; it is not the response to an ordinary bad release.

The rollback version must retain every binding used by that release. Deleted or incompatible storage bindings prevent Cloudflare from applying an older version.

## Caching

HTML revalidates on every request. Astro gives changed static assets new hashed filenames, while `_headers` assigns long-lived immutable caching to `/_astro/*` and `/fonts/*`. Normal releases do not require a cache purge.
