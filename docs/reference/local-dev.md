# Local development reference

What you need to run the site on your own computer and how to fix the dev server when it won't start. Reach for this when `pnpm dev` (see [glossary](./glossary.md#pnpm-dev)) fails or a local `/api/*` route misbehaves.

## Starting the dev server

```sh
pnpm dev
```

`pnpm dev` keeps the runtime pinned to Node `24.18.0` through the repo's
`package.json` and `.nvmrc`, then starts the local servers for you:

- [Portless](./glossary.md#portless) serves the site at `https://lvbt.localhost`
- Astro serves the site on `http://localhost:4320` and proxies `/api/*` to Wrangler
- Wrangler serves Pages Functions on `http://localhost:4321`

There are still three moving parts because each does one job a single server can't: Portless gives the project a stable local URL, Astro builds the pages and proxies `/api/*`, and Wrangler runs the backend functions.

| Layer            | URL / port               | Purpose                                                                                                                                                                                                                        |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Portless         | `https://lvbt.localhost` | Gives this checkout a stable local HTTPS URL and forwards traffic to Astro                                                                                                                                                     |
| Astro dev (Vite) | `http://localhost:4320`  | HMR (Hot Module Replacement — live-updates the page as you edit, no full reload; see [glossary](./glossary.md#hmr)), content changes, and `/api/*` proxying                                                                    |
| Wrangler Pages   | `http://localhost:4321`  | Serves Pages Functions (small backends that run on Cloudflare — see [glossary](./glossary.md#pages-function)); reads `.env.local` secrets. Wrangler is Cloudflare's command-line tool (see [glossary](./glossary.md#wrangler)) |

**Use `https://lvbt.localhost`** for local testing. On the first run, Portless may ask for permission to trust its local HTTPS certificate and bind the proxy port. After that, `pnpm dev` registers `lvbt.localhost` automatically.

`http://localhost:4320` is still useful as a direct Astro fallback if you are debugging Portless itself. Astro owns the page shell and HMR, while `/api/*` gets forwarded to the local Wrangler server.

## Troubleshooting

### "Address already in use" on startup

A previous dev session left processes on ports 4320 or 4321. Kill the servers with `lsof` (a tool that lists which process is using a port) piped into `kill`:

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

Astro's HMR runs on port 4320 behind Portless. If you're hitting 4321 directly, you'll only see the Wrangler function server, not the site shell. Use `https://lvbt.localhost` instead.
