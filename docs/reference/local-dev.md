# Local development reference

What you need to run the site on your own computer and how to fix the dev server when it won't start. Reach for this when `pnpm dev` (see [glossary](./glossary.md#pnpm-dev)) fails or a local `/api/*` route misbehaves.

## Starting the dev server

```sh
pnpm dev
```

`pnpm dev` keeps the runtime pinned to Node `24.20.0` through the repo's
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

The production-equivalent Worker runs separately after `pnpm build`:

```sh
pnpm worker:dev
```

This command serves the compiled Functions and `dist/` through the checked `wrangler.jsonc` contract. It does not replace the HMR-oriented `pnpm dev` loop.

**Use `https://lvbt.localhost`** for local testing. On the first run, Portless may ask for permission to trust its local HTTPS certificate and bind the proxy port. After that, `pnpm dev` registers `lvbt.localhost` automatically.

`http://localhost:4320` is still useful as a direct Astro fallback if you are debugging Portless itself. Astro owns the page shell and HMR, while `/api/*` gets forwarded to the local Wrangler server.

## Troubleshooting

### "Address already in use" on startup

A previous dev session left processes on ports 4320 or 4321. Kill the servers with `lsof` (a tool that lists which process is using a port) piped into `kill`:

```sh
lsof -ti:4320,4321 | xargs kill -9
```

Then re-run `pnpm dev`.

### Try the join form locally

The join form's handlers and the platform database run in the Worker, so try them with a production-like build:

```sh
pnpm exec wrangler d1 migrations apply lvbt-platform --local   # once, and after new migrations
pnpm worker:dev
```

Then open `/join/member` at the printed address. Joining needs the Beehiiv secrets in `.dev.vars` (Wrangler's local secrets file, which git ignores); without them the form shows "We couldn't finish joining you just now", which is the right behavior.

### Sign in and try the account pages locally

Sign-in runs in the same Worker. Put these lines in `.dev.vars`. The values are for your computer only, so any text will do:

```sh
LVBT_SIGN_IN_SECRET=local-sign-in-secret
LVBT_LINK_SIGNING_SECRET=local-link-secret
LVBT_DEV_LOG_CODES=1
```

With `LVBT_DEV_LOG_CODES=1` and no Resend key, every email that carries a code is printed in the terminal running `pnpm worker:dev` instead of being sent, for example `email (development) to ana@example.org: 123456 is your LVBT sign-in code`. Never set `LVBT_DEV_LOG_CODES` on a deployed Worker.

To have someone to sign in as, join at `/join/member` (with the Beehiiv secrets), or add a person to the local database:

```sh
pnpm exec wrangler d1 execute lvbt-platform --local --command "INSERT INTO people (id, given_name, email, membership_status, created_at, updated_at) VALUES ('01LOCALTESTPERSON000000000', 'Ana', 'ana@example.org', 'member', datetime('now'), datetime('now'))"
```

Then open `/sign-in`, enter that email and type the code from the terminal. Each address can ask for 5 codes an hour, the same as on the live site.

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
