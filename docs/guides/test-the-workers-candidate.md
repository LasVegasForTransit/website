# Test the Workers candidate

A candidate is a version of the production Worker that receives a versioned preview URL before deployment. It uses the production bindings, so browser tests use non-destructive data. The public hostnames stay on the previously deployed version until candidate checks pass.

## Check locally

Install the pinned toolchain and run the complete repository check:

```sh
pnpm bootstrap
pnpm check
```

The check compiles the existing Pages Functions into one Worker, validates the upload bundle, and starts it on an unused local port. A passing result includes `Worker parity checks passed.`

For interactive inspection, build and start the Worker directly:

```sh
pnpm worker:dev
```

Open the printed local URL. Visit the home page, an ordinary content page, and an unknown path. Submit only test payloads to local API routes; missing secrets intentionally return `503 service_unavailable`.

## Enable pull request previews

Create the `worker-preview` GitHub environment: repository → **Settings → Environments → New environment**, type `worker-preview`, then **Configure environment**. If it is already listed, open it instead — nothing below needs redoing.

Create its token: open `https://dash.cloudflare.com/<account-id>/api-tokens`, click **Create Token**, then **Create Custom Token** → **Get started** (there is no ready-made template this narrow). Name it `lvbt-website-preview (GitHub Actions)`. Under **Permissions**, add one row: **Account · Workers Scripts · Edit** — this uploads Worker versions but cannot touch a zone's routes or DNS. Under **Account Resources**, choose **Include** and the LVBT account. Leave **Zone Resources** at its default. Leave the TTL empty. Click **Continue to summary**, then **Create Token**, and copy it: Cloudflare shows it only once.

Under the `worker-preview` environment's **Environment secrets**, click **Add environment secret**, name it `CLOUDFLARE_WORKERS_API_TOKEN`, and paste the token — or run `gh secret set CLOUDFLARE_WORKERS_API_TOKEN --env worker-preview` and paste it at the prompt. `CLOUDFLARE_ACCOUNT_ID` is not secret and is read by jobs that declare no environment at all (the fork-safety check in `deploy-preview.yml`), so add it once as a plain repository variable instead: **Settings → Secrets and variables → Actions → Variables → New repository variable**, or `gh variable set CLOUDFLARE_ACCOUNT_ID`. Skip creating it again if it already exists — every workflow that needs a Cloudflare account ID reads this same one.

Set the repository variable `CLOUDFLARE_WORKERS_PREVIEW_ENABLED` to `true` after `pnpm worker:upload --env preview` succeeds for `lvbt-website-preview`, the separate Worker that pull request previews use. Re-run the pull request workflow and open the `Worker candidate` link in its comment.

The preview workflow runs the complete Playwright suite against the Worker URL. The same checks run locally against an uploaded candidate:

```sh
pnpm worker:test:live \
  --pages https://lasvegasfortransit.org \
  --worker https://<version>-lvbt-website-preview.<account>.workers.dev \
  --skip-api
PLAYWRIGHT_BASE_URL=https://<version>-lvbt-website-preview.<account>.workers.dev \
  pnpm worker:test:browser
```

Inspect the navigation at phone and desktop widths. Check the browser console, refresh a nested route, follow the sitemap redirect, open an event calendar file, and exercise each API with test credentials. Confirm Cloudflare Web Analytics does not record the preview hostname.

## Verify a main candidate

Create a separate `worker-candidate` GitHub environment the same way: **Settings → Environments → New environment**, type `worker-candidate`, **Configure environment**. It needs its own `CLOUDFLARE_WORKERS_API_TOKEN` environment secret — create a second custom token exactly as above (**Account · Workers Scripts · Edit**, scoped to the LVBT account; name it `lvbt-website candidate (GitHub Actions)` so it reads differently from the preview one in the token list) and add it under this environment's **Environment secrets**. It reads the same `CLOUDFLARE_ACCOUNT_ID` repository variable created above — do not make a second copy. Set the repository variable `CLOUDFLARE_WORKERS_CANDIDATE_ENABLED` to `true` only after the preview workflow passes.

Each successful `Deploy production` build starts `Deploy Worker candidate` for the same commit. The workflow uploads a version with the stable `candidate` preview alias and runs the browser suite. With `LVBT_WORKERS_PRODUCTION_ENABLED=true`, it deploys that version only after confirming that `main` still points at the tested commit. Use **Run workflow** on `main` to repeat the release without another build trigger.

Record the commit, version, and preview URL from the workflow summary with the release.

## Check production

After `Deploy Worker candidate` succeeds, compare `https://lasvegasfortransit.org` with the version URL recorded in its workflow summary. Check `https://www.lasvegasfortransit.org` redirects to the apex over valid TLS. Follow a content link, refresh a nested page, inspect an unknown path, and check an event calendar file. Confirm that production includes the Cloudflare Web Analytics beacon while version previews do not.

The `lvbt-website` Worker owns both public hostnames as custom domains. The Pages project has no custom-domain attachment. Its `lvbt-website-5zh.pages.dev` address remains available for emergency rollback; an ordinary release regression rolls back the Worker version without changing DNS. The [deployment pipeline](../reference/deployment-pipeline.md#rollback) records the recovery path.

## Record acceptance

Record the commit, Worker version, preview URL, and check time in the release record. Compare these behaviors before and after deployment:

| Surface               | Required result                                                       |
| --------------------- | --------------------------------------------------------------------- |
| `/` and content pages | Status, HTML, canonical metadata, and navigation match the candidate  |
| unknown path          | Branded `404.html` with status 404                                    |
| `_headers`            | Security and cache headers match the candidate                        |
| `_redirects`          | Every permanent redirect returns 301 to the same location             |
| `/events/*.ics`       | `text/calendar; charset=utf-8`                                        |
| `/api/*`              | Status, CORS, validation, and downstream behavior match the candidate |
| analytics             | Production hostname included; preview hostname excluded               |

Keep the previous Worker version and the Pages fallback available until the production check passes.
