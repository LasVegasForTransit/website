# Bootstrap CLI reference

The bootstrap CLI is the one command that sets up the whole project for you. It exists so a new contributor doesn't have to run a dozen manual steps (install tools, create accounts, wire up GitHub and Cloudflare) by hand and in the right order — it does them in sequence and remembers what's already done. It's a multi-phase CLI (command-line tool, run in your terminal) written in TypeScript (JavaScript with type labels — see [glossary](./glossary.md#typescript)) that walks the LVBT website from a fresh checkout to a deployed site. Source: `scripts/bootstrap/`.

For the narrative walk-through, see [tutorials/first-time-setup.md](../tutorials/first-time-setup.md).

## Before you start

The full setup (through the `deploy` and `domain` phases) needs a few accounts and
tools. The `install` and `auth` phases check these for you, but it's smoother to
have them ready:

- A **GitHub account** with an [SSH key set up](./glossary.md#ssh) — the `repo`
  phase pushes over SSH.
- A **Cloudflare account** — the `deploy` and `domain` phases use it.
- [`gh`](./glossary.md#gh) (GitHub's CLI) and [`wrangler`](./glossary.md#wrangler)
  (Cloudflare's CLI), installed and logged in.

Just want to run the site locally? `pnpm bootstrap --local-only` skips everything
above (no GitHub or Cloudflare needed).

## Commands

```sh
pnpm bootstrap              # full interactive setup
pnpm preflight              # read-only readiness check (no changes)
pnpm bootstrap --resume     # skip phases that already completed
pnpm bootstrap --local-only # run only install/workspace/env (no GitHub or Cloudflare)
pnpm bootstrap --phase <id> # run a single phase
```

**`--resume` vs `--phase`:** use `--resume` to continue a setup that stopped partway — it runs every phase _except_ the ones already marked complete in the state file (below). Use `--phase <id>` when you want to re-run exactly one named phase (e.g. `--phase deploy`), regardless of whether it already completed.

## Phases (in order)

The setup runs as a sequence of _phases_ — self-contained steps that each get you closer to a live site, from checking your tools (`install`) through installing dependencies (`workspace`), writing config (`env`), and finally creating the GitHub repo and Cloudflare deployment. They run top to bottom; later phases assume earlier ones succeeded.

| Phase       | What it does                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install`   | Verifies Node ≥24.18.0, pnpm ≥10, [GitHub CLI](./glossary.md#gh), [Cloudflare Wrangler](./glossary.md#wrangler), [`dig`](./glossary.md#dig) — offers to install missing tools      |
| `auth`      | Confirms `gh auth status` and `wrangler whoami`                                                                                                                                    |
| `workspace` | Runs `pnpm install --frozen-lockfile` (installs the exact pinned versions from the [lockfile](./glossary.md#lockfile); fails instead of updating it) and a `pnpm build` smoke test |
| `env`       | Creates `.env.local` from `.env.example`; prompts for live `PUBLIC_LVBT_*` URLs                                                                                                    |
| `repo`      | Creates a GitHub repo via `gh repo create` and wires `origin` to the [SSH URL](./glossary.md#ssh)                                                                                  |
| `deploy`    | Provisions a Cloudflare Pages project and deploys `./dist`                                                                                                                         |
| `domain`    | Attaches [apex](./glossary.md#apex-domain) + www to the Pages project; auto-creates [DNS](./glossary.md#dns) via the Cloudflare API                                                |

## State file

The bootstrap remembers its progress in a small file so it can pick up where it left off. `.lvbt/dev-readiness.json` (a local, git-ignored file in the `.lvbt/` folder) tracks per-phase status (`complete | partial | failed | skipped`) and per-tool readiness. `--resume` reads this file and skips phases marked `complete`.

`.env.local` doubles as the cross-phase persistence layer for values that need to survive between phases (e.g. `CLOUDFLARE_PAGES_PROJECT`, `CLOUDFLARE_ACCOUNT_ID`). `cold-start.ts` hydrates `process.env` from it at startup.

## Defaults

| Knob                     | Default                                   | Override                                     |
| ------------------------ | ----------------------------------------- | -------------------------------------------- |
| GitHub repo              | `<parent-dir>/<dir>` (filesystem-derived) | Prompt accepts `<owner>/<name>`              |
| GitHub visibility        | public                                    | Prompt                                       |
| Cloudflare Pages project | `lvbt-website`                            | `CLOUDFLARE_PAGES_PROJECT` env var or prompt |
| Production branch        | `main`                                    | `CLOUDFLARE_PAGES_BRANCH` env var or prompt  |
| Apex domain              | `lasvegasfortransit.org`                  | `LVBT_DOMAIN` env var or prompt              |
| Cloudflare account       | auto-selected if only one                 | `CLOUDFLARE_ACCOUNT_ID` env var or prompt    |

## Adding a new phase

1. Create a module at `scripts/bootstrap/phases/<name>.ts` that exports `run<Name>Phase(projectRoot, doctorMode): Promise<PhaseResult>`.
2. Add the id to `PhaseId` in `scripts/bootstrap/lib/types.ts`.
3. Register the phase in `PHASE_ORDER` and `PHASE_INFO` in `scripts/bootstrap/cold-start.ts`, and add a case to `runPhaseById`.
4. Each phase returns `{ success, followUpItems[] }`. Follow-up `kind` is `'local' | 'auth' | 'remote'`.

## Implementation notes

- Output uses `@clack/prompts` for boxed notes/spinners and `picocolors` for highlight color.
- Shared helpers: `lib/shell.ts` (subprocess + shell-escape), `lib/ui.ts` (prompt wrappers + tool tables), `lib/env-file.ts` (`.env` parsing/merge), `lib/validators.ts` (shared `text({ validate })` validators), `lib/cloudflare-api.ts` (REST client + OAuth-token reader).
- We intentionally do **not** scrape English error strings from CLI output. Where we need to detect a specific failure (e.g. "Pages project name taken"), we look for the stable Cloudflare numeric error code (`CF_ERROR.PAGES_PROJECT_NAME_TAKEN = 8000002`).
