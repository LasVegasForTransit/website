# First-time setup

This is the walk-through for getting the LVBT site from a fresh checkout to a live deploy. It covers what `pnpm bootstrap` will do, what it'll ask you, and what to expect at each step.

If you just want the flag list, see [reference/bootstrap.md](../reference/bootstrap.md) instead. **Just want to edit content, not deploy your own copy of the whole site?** You probably don't need this page — see [Start here](./start-here.md).

## Before you start

You need:

- A terminal with [`node`](../reference/glossary.md#node) (≥22), [`pnpm`](../reference/glossary.md#pnpm) (≥10), `gh` (the GitHub command-line tool), and [`wrangler`](../reference/glossary.md#wrangler) (Cloudflare's command-line tool). The `install` phase will offer to install missing tools.
- A GitHub account (for the `repo` phase).
- A Cloudflare account with at least one **zone** (a [domain Cloudflare manages](../reference/glossary.md#zone)) if you want it to set up [DNS](../reference/glossary.md#dns) for you (the `domain` phase). Otherwise the bootstrap tells you which [CNAME](../reference/glossary.md#cname) record to add wherever you bought your domain (your "registrar").

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

6. **deploy** — Checks whether the Cloudflare Pages project (default name `lvbt-website`, default branch `main`) exists and already has a production deployment. If both are there, it does nothing. Otherwise it creates the project and deploys `./dist` once. After that, every push to `main` deploys through GitHub Actions.

7. **domain** — Attaches your [apex domain](../reference/glossary.md#apex-domain) (the bare `lasvegasfortransit.org`, no `www.`) and any extra hostnames to the Pages project via the Cloudflare API, skipping any that are already attached. If your DNS [zone](../reference/glossary.md#zone) is in the same Cloudflare account, it creates the missing [CNAME](../reference/glossary.md#cname) records. If not, it tells you which CNAME to add at your registrar.

8. **secrets** — Checks every server-side secret the live site needs and asks for each missing one once, with click-by-click steps. See [platform secrets](../reference/platform-secrets.md).

## What you'll see at the end

A bordered status panel showing which phases completed, a follow-up panel grouped by category (auth / local / remote actions), and a "next steps" panel with day-to-day commands.

If a phase reports `partial` (it did some of its work but couldn't finish — e.g. it created the repo but a remote step still needs your input), the next-steps panel tells you exactly which `pnpm bootstrap --phase <id>` to re-run.

## Re-running

The whole flow is [idempotent](../reference/glossary.md#idempotent) — safe to run again; it won't redo or duplicate work it already finished, and it never asks again for a secret that is already stored. On a finished setup, a second run changes nothing and reports every phase as ready. `pnpm bootstrap --resume` skips completed phases. `pnpm bootstrap --phase env` re-runs a single phase. `pnpm preflight` does a read-only check without changing anything. To push the site again or replace a secret on purpose, see the `--redeploy` and `--rotate` options in the [bootstrap reference](../reference/bootstrap.md#running-it-again-is-safe).
