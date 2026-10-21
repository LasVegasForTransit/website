# Local development reference

Contributors use this page to run the site on their own computer and fix local server failures.
Reach for this when `pnpm dev` (see [glossary](./glossary.md#pnpm-dev)) fails or a local `/api/*`
route misbehaves.

## Starting the dev server

```sh
pnpm dev
```

Run it from the repository root. The site itself lives in `apps/site`, so your private settings live
there too: `apps/site/.env.local` and `apps/site/.dev.vars`. Run `pnpm bootstrap` once from a fresh
clone to install dependencies and seed `.env.local`; an existing file is preserved. No Cloudflare
login is required. Empty optional integration settings produce warnings and leave only the
corresponding feature unavailable. If you set up your checkout before the site moved into
`apps/site`, move your local environment files into `apps/site` once.

`pnpm dev` needs Node 24.20.0 or newer in the 24.x line, the range `engines.node` in `package.json`
names. It starts the local servers for you:

- [Portless](./glossary.md#portless) serves the site at `https://lvbt.localhost`
- Astro serves the site on `http://localhost:4320` and proxies `/api/*` to Wrangler
- Wrangler serves Pages Functions on `http://localhost:4321`

There are still three moving parts because each does one job a single server can't: Portless gives
the project a stable local URL, Astro builds the pages and proxies `/api/*`, and Wrangler runs the
backend functions.

| Layer            | URL / port               | Purpose                                                                                                                                                                                                                                  |
| ---------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portless         | `https://lvbt.localhost` | Gives this checkout a stable local HTTPS URL and forwards traffic to Astro                                                                                                                                                               |
| Astro dev (Vite) | `http://localhost:4320`  | HMR (Hot Module Replacement — live-updates the page as you edit, no full reload; see [glossary](./glossary.md#hmr)), content changes, and `/api/*` proxying                                                                              |
| Wrangler Pages   | `http://localhost:4321`  | Serves Pages Functions (small backends that run on Cloudflare — see [glossary](./glossary.md#pages-function)); reads `apps/site/.env.local` secrets. Wrangler is Cloudflare's command-line tool (see [glossary](./glossary.md#wrangler)) |

The production-equivalent Worker runs separately after `pnpm build`:

```sh
pnpm -C apps/site worker:dev
```

This command serves the compiled Functions and `apps/site/dist/` through the checked
`apps/site/wrangler.jsonc` contract. It does not replace the HMR-oriented `pnpm dev` loop.

**Use `https://lvbt.localhost`** for local testing. On the first run, Portless may ask for
permission to trust its local HTTPS certificate and bind the proxy port. After that, `pnpm dev`
registers `lvbt.localhost` automatically.

`http://localhost:4320` is still useful as a direct Astro fallback if you are debugging Portless
itself. Astro owns the page shell and HMR, while `/api/*` gets forwarded to the local Wrangler
server.

## Troubleshooting

### "Address already in use" on startup

Another process is using port 4320 or 4321. List the processes before stopping anything:

```sh
lsof -nP -iTCP:4320 -iTCP:4321 -sTCP:LISTEN
```

If the process is your previous dev server, press Ctrl+C in its terminal. If that terminal has
closed, run `kill <PID>` with the process ID from `lsof`. Then run `pnpm dev` again. Leave unrelated
processes running.

### Try the join form locally

The join form's handlers and the platform database run in the Worker, so try them with a
production-like build:

```sh
pnpm -C apps/site exec wrangler d1 migrations apply lvbt-platform --local   # once, and after new migrations
pnpm -C apps/site worker:dev
```

Then open `/join/member` at the printed address. Set a local `LVBT_LINK_SIGNING_SECRET` in
`apps/site/.dev.vars`, Wrangler's ignored local settings file. Joining saves the member and queues
newsletter delivery in the local database. It does not need Beehiiv credentials. Checking delivery
requires the separately configured jobs Worker; use isolated provider fixtures for ordinary tests.

### Sign in and try the account pages locally

Sign-in runs in the same Worker. Put these lines in `apps/site/.dev.vars`. The values are for your
computer only, so any text will do:

```sh
LVBT_SIGN_IN_SECRET=local-sign-in-secret
LVBT_LINK_SIGNING_SECRET=local-link-secret
LVBT_DEV_LOG_CODES=1
```

With `LVBT_DEV_LOG_CODES=1` and no Resend key, every email that carries a code is printed in the
terminal running `pnpm -C apps/site worker:dev` instead of being sent, for example
`email (development) to ana@example.org: 123456 is your LVBT sign-in code`. Never set
`LVBT_DEV_LOG_CODES` on a deployed Worker.

To have someone to sign in as, join at `/join/member` with the local signing secret, or add a person
to the local database:

```sh
pnpm -C apps/site exec wrangler d1 execute lvbt-platform --local --command "INSERT INTO people (id, given_name, email, membership_status, created_at, updated_at) VALUES ('01LOCALTESTPERSON000000000', 'Ana', 'ana@example.org', 'member', datetime('now'), datetime('now'))"
```

Then open `/sign-in`, enter that email and type the code from the terminal. Each address can ask for
5 codes an hour, the same as on the live site.

### Notion-backed pages have no data locally

Wrangler reads the optional press and transit-news Notion settings from `apps/site/.env.local`:

```text
LVBT_NOTION_API_KEY=...
LVBT_PRESS_DATA_SOURCE_ID=...
```

The membership intake endpoint also needs `LVBT_MEMBERSHIP_INTAKE_SECRET`. See
[membership intake automation](./membership-intake.md) for its endpoint contract and Google Forms
setup. See [add press coverage](../guides/add-press-coverage.md) to configure the `/press` database.

### HMR not reflecting changes

Astro's HMR runs on port 4320 behind Portless. If you're hitting 4321 directly, you'll only see the
Wrangler function server, not the site shell. Use `https://lvbt.localhost` instead.
