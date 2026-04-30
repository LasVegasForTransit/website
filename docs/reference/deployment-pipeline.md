# Deployment pipeline

How code gets from a `git push` to `lasvegasfortransit.org`.

For one-time provisioning (creating the Pages project, attaching the domain, wiring DNS), see [bootstrap.md](./bootstrap.md) and [tutorials/first-time-setup.md](../tutorials/first-time-setup.md).

## At a glance

```
git push origin main           git push origin <branch>
       │                              │
       ▼                              ▼
Cloudflare Pages              Cloudflare Pages
  production build              preview build
       │                              │
       ▼                              ▼
lasvegasfortransit.org      <hash>.lvbt-website.pages.dev
                            (commented on the PR)
```

## What's connected to what

| Piece                    | Where it lives                       | Notes                                                                                                                 |
| ------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| GitHub repo              | `LasVegansForTransit/website`        | `origin` is wired over SSH (see [design-decisions.md](../explanation/design-decisions.md#ssh-origin-urls-by-default)) |
| Cloudflare Pages project | `lvbt-website`                       | Provisioned by `pnpm bootstrap --phase deploy`                                                                        |
| Production branch        | `main`                               | Pushes here trigger production deploys                                                                                |
| Preview deploys          | every PR / non-main branch           | Cloudflare comments the preview URL on the PR                                                                         |
| Production hostname      | `lasvegasfortransit.org` (+ `www.…`) | Attached by `pnpm bootstrap --phase domain`                                                                           |
| Build runner             | Cloudflare Pages CI                  | Runs `pnpm build` in a clean container                                                                                |

The Git connection itself is set up once in the Cloudflare dashboard, not via CLI — wrangler doesn't expose this. The bootstrap's `deploy` phase prints a deep link to the right settings page after the first manual `wrangler pages deploy`.

## Build settings (Cloudflare Pages → Settings → Builds)

- **Framework preset:** Astro
- **Build command:** `pnpm build`
- **Build output directory:** `dist`
- **Node version:** 24
- **Root directory:** repo root
- **Environment variables:** see below

## Environment variables in production

The site uses build-time `PUBLIC_LVBT_*` env vars (newsletter URL, donate URL, social URLs). For Cloudflare Pages to bake these into the production build, they need to be set on the Pages project:

1. Cloudflare dashboard → Pages → `lvbt-website` → Settings → Environment variables.
2. Add each `PUBLIC_LVBT_*` from your local `.env.local` to the **Production** environment.
3. Redeploy — env vars are bound at build time, not runtime, so an existing build won't pick them up.

A future bootstrap improvement would push these via the API automatically. For now, it's manual.

## Rolling back

Cloudflare dashboard → Pages → `lvbt-website` → Deployments → pick a previous successful deployment → "Rollback to this deployment". Takes effect within seconds; DNS doesn't change.

There's no automatic rollback on failed builds — a failed build leaves the previous deployment live.

## Manual deploys

If you ever need to push a build from your machine without going through Git:

```sh
pnpm build
wrangler pages deploy ./dist --project-name=lvbt-website --branch=main --commit-dirty=true
```

This is what `pnpm bootstrap --phase deploy` runs under the hood. Useful for testing a deploy locally before merging, or for deploying out-of-band fixes when GitHub is degraded.

## Cache and invalidation

Cloudflare Pages serves static assets with aggressive cache headers; HTML is revalidated on every request. After a deploy, new HTML is visible immediately; static assets at hashed URLs (Astro adds content hashes) are versioned automatically. There's no cache-purge step needed for normal deploys.

## DNS propagation

The custom domain attaches via the Cloudflare API and (when the zone lives in the same Cloudflare account) auto-creates CNAME records pointing at `lvbt-website.pages.dev`. Propagation typically takes a few minutes; `pnpm bootstrap --phase domain` runs `dig` afterwards so you can see the live state.

If your DNS zone is at a different registrar, the bootstrap leaves a follow-up with the exact CNAME records to add manually.
