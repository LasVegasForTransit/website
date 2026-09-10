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

Create the `worker-preview` GitHub environment. Add `CLOUDFLARE_WORKERS_API_TOKEN` as its secret and `CLOUDFLARE_ACCOUNT_ID` as an environment or repository variable. The token needs Worker script version upload access and no zone-edit permission.

Set the repository variable `CLOUDFLARE_WORKERS_PREVIEW_ENABLED` to `true` after `pnpm worker:upload` succeeds for `lvbt-website`. Re-run the pull request workflow and open the `Worker candidate` link in its comment.

Inspect the navigation at phone and desktop widths. Check the browser console, refresh a nested route, follow the sitemap redirect, open an event calendar file, and exercise each API with test credentials. Confirm Cloudflare Web Analytics does not record the preview hostname.

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
