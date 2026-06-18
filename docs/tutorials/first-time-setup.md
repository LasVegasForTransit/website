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

`pnpm bootstrap` is interactive. It prints an overview of all seven phases, then runs them in order. You can `Ctrl+C` at any time — progress saves between phases under `.lvbt/dev-readiness.json`. Pick up where you left off with `pnpm bootstrap --resume`.

## What each phase does, in plain language

1. **install** — Verifies your toolchain. If anything's missing or out of date, it offers to install it via Homebrew (macOS) or apt (Linux). Skip if you only need local dev today.

2. **auth** — Confirms `gh auth status` and `wrangler whoami` succeed. If not, drops you into the interactive login flows.

3. **workspace** — Runs `pnpm install --frozen-lockfile` (installs the exact dependency versions pinned in the [lockfile](../reference/glossary.md#lockfile), no surprises) and a `pnpm build` smoke test. Catches setup issues before you touch anything remote.

4. **env** — Creates `.env.local` from `.env.example`. Shows which `PUBLIC_LVBT_*` values are still placeholders. Asks once whether you want to fill them in now; if not, placeholders stay and the site still builds.

5. **repo** — If `origin` isn't set yet, creates a GitHub repo via `gh repo create` and wires `origin` to its **SSH URL** (the `git@github.com:…` address Git pushes to, which relies on your SSH key being set up). Auto-creates an initial commit if the working tree has none. Defaults the name to `<parent-dir>/<dir>` (so `~/Projects/LasVegansForTransit/website` becomes `LasVegansForTransit/website`).

6. **deploy** — Provisions the Cloudflare Pages project (default name `lvbt-website`, default branch `main`) and deploys `./dist`. Persists the project name and branch back into `.env.local` so the next phase can use them.

7. **domain** — Attaches your [apex domain](../reference/glossary.md#apex-domain) (the bare `lasvegasfortransit.org`, no `www.`) and `www.<apex>` to the Pages project via the Cloudflare API. If your DNS [zone](../reference/glossary.md#zone) is in the same Cloudflare account, it auto-creates the [CNAME](../reference/glossary.md#cname) records. If not, it tells you which CNAME to add at your registrar.

## What you'll see at the end

A bordered status panel showing which phases completed, a follow-up panel grouped by category (auth / local / remote actions), and a "next steps" panel with day-to-day commands.

If a phase reports `partial` (it did some of its work but couldn't finish — e.g. it created the repo but a remote step still needs your input), the next-steps panel tells you exactly which `pnpm bootstrap --phase <id>` to re-run.

## Re-running

The whole flow is [idempotent](../reference/glossary.md#idempotent) — safe to run again; it won't redo or duplicate work it already finished. `pnpm bootstrap --resume` skips completed phases. `pnpm bootstrap --phase env` re-runs a single phase. `pnpm preflight` does a read-only check without changing anything.
