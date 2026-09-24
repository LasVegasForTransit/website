# Test the Workers candidate

The Workers candidate runs beside the Pages production site. These checks establish equivalence without changing DNS or the production route.

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

The preview workflow compares the Worker with the Pages production origin, then runs the complete Playwright suite against the Worker URL. The same checks run locally against an uploaded candidate:

```sh
pnpm worker:test:live \
  --pages https://lasvegasfortransit.org \
  --worker https://<version>-lvbt-website-preview.<account>.workers.dev
PLAYWRIGHT_BASE_URL=https://<version>-lvbt-website-preview.<account>.workers.dev \
  pnpm worker:test:browser
```

Inspect the navigation at phone and desktop widths. Check the browser console, refresh a nested route, follow the sitemap redirect, open an event calendar file, and exercise each API with test credentials. Confirm Cloudflare Web Analytics does not record the preview hostname.

## Verify a main candidate

Create a separate `worker-candidate` GitHub environment the same way: **Settings → Environments → New environment**, type `worker-candidate`, **Configure environment**. It needs its own `CLOUDFLARE_WORKERS_API_TOKEN` environment secret — create a second custom token exactly as above (**Account · Workers Scripts · Edit**, scoped to the LVBT account; name it `lvbt-website candidate (GitHub Actions)` so it reads differently from the preview one in the token list) and add it under this environment's **Environment secrets**. It reads the same `CLOUDFLARE_ACCOUNT_ID` repository variable created above — do not make a second copy. Set the repository variable `CLOUDFLARE_WORKERS_CANDIDATE_ENABLED` to `true` only after the preview workflow passes.

Each successful Pages production run then starts `Deploy Worker candidate` for the same commit. The
workflow uploads a version with the stable `candidate` preview alias, compares it with Pages, and
runs the browser suite. It does not attach a route. Use **Run workflow** on `main` to repeat the check
without publishing Pages again.

Copy the commit, version, and preview URL from the workflow summary into the cutover change.

## Switch production

Confirm the current `main` commit has a passing candidate run and record the Pages deployment ID.
Keep the Pages custom domains and DNS records in place during the first switch. Set the repository
variable `LVBT_WORKERS_PRODUCTION_ENABLED` to `true`, then run `Deploy Worker candidate` on `main`.
The workflow deploys the verified Worker version and compares it with the production hostname.

Attach `lasvegasfortransit.org/*` and `www.lasvegasfortransit.org/*` to `lvbt-website` as Worker
routes. Check both hostnames over HTTPS, including `/`, a content page, an unknown path, redirects,
calendar files, and the intake endpoints. Confirm analytics appears on the production hostname and
not on the version preview. Keep the Pages project available as the fallback until these checks
pass. Remove either route to send that hostname back to Pages if the Worker fails live checks.

After the route overlay proves stable, replace the Pages CNAMEs and domain attachments with Worker
custom domains. Check TLS and the same HTTP contract again before retiring the Pages deployment.
Cloudflare requires the Pages CNAME to be removed before a Worker custom domain can use that
hostname.

## Record acceptance

Record the commit, Worker version, Pages deployment, preview URL, and check time in the cutover change. Compare these behaviors before attaching the production hostname:

| Surface               | Required result                                               |
| --------------------- | ------------------------------------------------------------- |
| `/` and content pages | Status, HTML, canonical metadata, and navigation match Pages  |
| unknown path          | Branded `404.html` with status 404                            |
| `_headers`            | Security and cache headers match Pages                        |
| `_redirects`          | Every permanent redirect returns 301 to the same location     |
| `/events/*.ics`       | `text/calendar; charset=utf-8`                                |
| `/api/*`              | Status, CORS, validation, and downstream behavior match Pages |
| analytics             | Production hostname included; preview hostname excluded       |

Keep the Pages deployment and its hostname attachment intact until the post-cutover production check passes.
