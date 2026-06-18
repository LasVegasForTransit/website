# Local development reference

What you need to run the site on your own computer and how to fix the dev server when it won't start. Reach for this when `pnpm dev` (see [glossary](./glossary.md#pnpm-dev)) fails or a local `/api/*` route misbehaves.

## Starting the dev server

```sh
pnpm dev
```

Runs three layers concurrently. There are three because each does one job a single server can't: Astro builds the pages, Wrangler runs the backend functions, and the proxy stitches both behind one HTTPS URL that mimics production.

| Layer            | Port | Purpose                                                                                                                                                                                                                                         |
| ---------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Astro dev (Vite) | 4320 | HMR (Hot Module Replacement — live-updates the page as you edit, no full reload; see [glossary](./glossary.md#hmr)), content changes                                                                                                            |
| Wrangler Pages   | 4321 | Routes `/api/*` through Pages Functions (small backends that run on Cloudflare — see [glossary](./glossary.md#pages-function)); reads `.env.local` secrets. Wrangler is Cloudflare's command-line tool (see [glossary](./glossary.md#wrangler)) |
| portless proxy   | 1355 | Serves everything at `https://lvbt.localhost:1355`                                                                                                                                                                                              |

**Use `https://lvbt.localhost:1355`** for local testing — it's the URL the `pnpm screenshot` script defaults to and the closest match to the production environment.

## Troubleshooting

### "Address already in use" on startup

A previous dev session left processes on ports 4320, 4321, or 1355. Kill them with `lsof` (a tool that lists which process is using a port) piped into `kill`:

```sh
lsof -ti:4320,4321 | xargs kill -9
```

Then re-run `pnpm dev`.

### `/api/subscribe` returns an error locally

Wrangler reads secrets from `.env.local`. Make sure both are set:

```
LVBT_BEEHIIV_API_KEY=...
LVBT_BEEHIIV_PUBLICATION_ID=pub_...
```

Run `pnpm preflight` to check the current state of all config values.

### `/api/membership-intake` returns an error locally

Wrangler reads the intake, Beehiiv, and Notion secrets from `.env.local`:

```
LVBT_MEMBERSHIP_INTAKE_SECRET=...
LVBT_BEEHIIV_API_KEY=...
LVBT_BEEHIIV_PUBLICATION_ID=pub_...
LVBT_NOTION_API_KEY=...
LVBT_NOTION_DATA_SOURCE_ID=...
```

See [membership intake automation](./membership-intake.md) for the endpoint contract and Google Forms setup.

### HMR not reflecting changes

Astro's HMR runs on port 4320, not 1355. If you're hitting 4320 directly, Pages Functions (`/api/*`) won't be available. Use 1355 instead.
