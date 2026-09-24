# First-time setup

This walkthrough takes a website checkout through local setup and checks the existing LVBT production resources. `pnpm bootstrap` presents each missing action before it changes GitHub or Cloudflare.

If you just want the flag list, see [reference/bootstrap.md](../reference/bootstrap.md) instead. **Just want to edit content, not deploy your own copy of the whole site?** You probably don't need this page — see [Start here](./start-here.md).

## Before you start

You need:

- A terminal with [`node`](../reference/glossary.md#node) 24.20.0, [`pnpm`](../reference/glossary.md#pnpm) 11.25.0, `gh` (the GitHub command-line tool), and [`wrangler`](../reference/glossary.md#wrangler) (Cloudflare's command-line tool). The `install` phase offers to install missing tools.
- A GitHub account (for the `repo` phase).
- Access to the LVBT Cloudflare account and the `lasvegasfortransit.org` [zone](../reference/glossary.md#zone).

## Run it

```sh
pnpm install
pnpm bootstrap
```

`pnpm bootstrap` is interactive. It prints an overview of all eight phases, then runs them in order. You can `Ctrl+C` at any time. Run the same command again later and it picks up where you left off, because every phase checks what is already done before it changes anything.

## What each phase does, in plain language

1. **install** — Verifies your toolchain. If anything's missing or out of date, it offers to install it via Homebrew (macOS) or apt (Linux). Skip if you only need local dev today.

2. **auth** — Confirms `gh auth status` and `wrangler whoami` succeed. If not, drops you into the interactive login flows.

3. **workspace** — Runs `pnpm install --frozen-lockfile` (installs the exact dependency versions pinned in the [lockfile](../reference/glossary.md#lockfile), no surprises) and a `pnpm build` smoke test. Catches setup issues before you touch anything remote.

4. **env** — Creates `.env.local` from `.env.example`. Shows which values are still placeholders. Asks once whether you want to fill them in now; if not, placeholders stay and the site still builds. Everything here is for your machine only; the live site gets its values elsewhere (step 8 and GitHub Actions variables).

5. **repo** — If `origin` isn't set yet, creates a GitHub repo via `gh repo create` and wires `origin` to its **SSH URL** (the `git@github.com:…` address Git pushes to, which relies on your SSH key being set up). Auto-creates an initial commit if the working tree has none. Defaults the name to `<parent-dir>/<dir>` (so `~/Projects/LasVegansForTransit/website` becomes `LasVegansForTransit/website`).

6. **deploy** — Checks for a production deployment of the `lvbt-website` Worker. If one exists, it does nothing. Otherwise it offers to build and deploy the Worker. Routine releases from `main` run through GitHub Actions.

7. **domain** — Confirms that the [apex domain](../reference/glossary.md#apex-domain) and `www` belong to the production Worker. It offers to attach missing custom domains; Cloudflare handles their DNS records and certificates. A hostname already owned by another service is left untouched.

8. **secrets** — Checks every server-side secret the live site needs and asks for each missing one once, with click-by-click steps. See [platform secrets](../reference/platform-secrets.md).

## What you'll see at the end

A bordered status panel showing which phases completed, a follow-up panel grouped by category (auth / local / remote actions), and a "next steps" panel with day-to-day commands.

If a phase reports `partial` (it did some of its work but couldn't finish — e.g. it created the repo but a remote step still needs your input), the next-steps panel tells you exactly which `pnpm bootstrap --phase <id>` to re-run.

## Re-running

The whole flow is [idempotent](../reference/glossary.md#idempotent) — safe to run again; it won't redo or duplicate work it already finished, and it never asks again for a secret that is already stored. On a finished setup, a second run changes nothing and reports every phase as ready. `pnpm bootstrap --resume` skips completed phases. `pnpm bootstrap --phase env` re-runs a single phase. `pnpm preflight` does a read-only check without changing anything. To push the site again or replace a secret on purpose, see the `--redeploy` and `--rotate` options in the [bootstrap reference](../reference/bootstrap.md#running-it-again-is-safe).
