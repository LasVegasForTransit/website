# Local development reference

## Starting the dev server

```sh
pnpm dev
```

Runs three layers concurrently:

| Layer            | Port | Purpose                                                             |
| ---------------- | ---- | ------------------------------------------------------------------- |
| Astro dev (Vite) | 4320 | HMR, content changes                                                |
| Wrangler Pages   | 4321 | Routes `/api/*` through Pages Functions; reads `.env.local` secrets |
| portless proxy   | 1355 | Serves everything at `https://lvbt.localhost:1355`                  |

**Use `https://lvbt.localhost:1355`** for local testing — it's the URL the `pnpm screenshot` script defaults to and the closest match to the production environment.

## Troubleshooting

### "Address already in use" on startup

A previous dev session left processes on ports 4320, 4321, or 1355. Kill them:

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
