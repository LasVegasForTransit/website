# Deployment pipeline

How code gets from a `git push` to `lasvegasfortransit.org`. Read this when you want to understand
what happens after you push, set up production env vars, or roll back a bad deploy.

The whole flow is CI/CD (Continuous Integration / Delivery — automation that builds and ships the
site every time you push, with no manual steps; see
[glossary](../../development/reference/glossary.md#ci)). Cloudflare watches the GitHub repo and
rebuilds the site for you.

For one-time provisioning (creating the Pages project, attaching the domain, wiring DNS — the system
that maps the domain name to a server; see [glossary](../../development/reference/glossary.md#dns)),
see [bootstrap.md](./bootstrap.md) and
[tutorials/first-time-setup.md](../../development/tutorials/first-time-setup.md).

## At a glance

```text
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

| Piece                    | Where it lives                       | Notes                                                                                                                            |
| ------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| GitHub repo              | `LasVegansForTransit/website`        | `origin` is wired over SSH (see [design-decisions.md](../../product/explanation/design-decisions.md#ssh-origin-urls-by-default)) |
| Cloudflare Pages project | `lvbt-website`                       | Provisioned by `pnpm bootstrap --phase deploy`                                                                                   |
| Production branch        | `main`                               | Pushes here trigger production deploys                                                                                           |
| Preview deploys          | every PR / non-main branch           | Cloudflare comments the preview URL on the PR                                                                                    |
| Production hostname      | `lasvegasfortransit.org` (+ `www.…`) | Attached by `pnpm bootstrap --phase domain`                                                                                      |
| Build runner             | Cloudflare Pages CI                  | Runs `pnpm build` in a clean container                                                                                           |

The Git connection itself is set up once in the Cloudflare dashboard, not via CLI — wrangler
(Cloudflare's command-line tool — see [glossary](../../development/reference/glossary.md#wrangler))
doesn't expose this. The bootstrap's `deploy` phase prints a deep link to the right settings page
after the first manual `wrangler pages deploy`.

## Build settings (Cloudflare Pages → Settings → Builds)

- **Framework preset:** Astro
- **Build command:** `pnpm build`
- **Build output directory:** `dist`
- **Node version:** 24
- **Root directory:** repo root
- **Environment variables:** see below

## Environment variables in production

The site uses build-time `PUBLIC_LVBT_*` env vars (environment variables — named settings kept
outside the code; see [glossary](../../development/reference/glossary.md#env-var)) for the
newsletter URL, donate URL, and social URLs. Your `.env.local` only exists on your laptop and is
never committed (see [glossary](../../development/reference/glossary.md#env-files)) — the production
build runs on Cloudflare's servers, which can't see your laptop, so the same values must also be set
on the Pages project. For Cloudflare Pages to bake these into the production build, they need to be
set on the Pages project:

1. Cloudflare dashboard → Pages → `lvbt-website` → Settings → Environment variables.
2. Add each `PUBLIC_LVBT_*` from your local `.env.local` to the **Production** environment.
3. Redeploy — env vars are bound at build time, not runtime, so an existing build won't pick them
   up.

A future bootstrap improvement would push these via the API automatically. For now, it's manual.

## Rolling back

Cloudflare dashboard → Pages → `lvbt-website` → Deployments → pick a previous successful deployment
→ "Rollback to this deployment". Takes effect within seconds; DNS doesn't change.

There's no automatic rollback on failed builds — a failed build leaves the previous deployment live.

## Manual deploys

If you ever need to push a build from your machine without going through Git:

```sh
pnpm build
wrangler pages deploy ./dist --project-name=lvbt-website --branch=main --commit-dirty=true
```

This is what `pnpm bootstrap --phase deploy` runs under the hood. Useful for testing a deploy
locally before merging, or for deploying out-of-band fixes when GitHub is degraded.

## Cache and invalidation

Cloudflare Pages serves static assets with aggressive cache headers; HTML is revalidated on every
request. After a deploy, new HTML is visible immediately; static assets at hashed URLs (Astro adds
_content hashes_ — a code in each filename derived from the file's contents, like `app.4f2a1b.js`,
so any change produces a new filename) are versioned automatically. Because the filename changes
whenever the content changes, browsers fetch the new file instead of a stale cached copy, so there's
no cache-purge step needed for normal deploys.

## DNS propagation

The custom domain attaches via the Cloudflare API and (when the zone lives in the same Cloudflare
account — a _zone_ is a domain Cloudflare manages plus its DNS records; see
[glossary](../../development/reference/glossary.md#zone)) auto-creates CNAME records (a DNS record
that points one domain name at another; see
[glossary](../../development/reference/glossary.md#cname)) pointing at `lvbt-website.pages.dev`.
Propagation typically takes a few minutes; `pnpm bootstrap --phase domain` runs `dig` (a
command-line tool that looks up a domain's live DNS records) afterwards so you can see the live
state.

If your DNS zone is at a different registrar, the bootstrap leaves a follow-up with the exact CNAME
records to add manually.
